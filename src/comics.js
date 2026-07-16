// src/comics.js — the comic content engine (the reader-side analog of player.js).
//
// Comics arrive from the backend as TorBox HTTPS links in one of two shapes:
//   • "archives": one or more .cbz/.cbr/... files → download + extract, then read
//   • "images":   a loose folder of page images   → stream the URLs directly
//
// Extraction always lands on disk (react-native-zip-archive streams the zip),
// so even 200MB+ volumes never pass through JS memory.
//
// Two extraction paths, mirroring how audio handles stream-vs-offline:
//   prepareArchiveFromUrl — "Read now": download into the CACHE dir, extract,
//     delete the archive. The OS may purge this; Settings has a clear button.
//   ensureExtracted — offline: entry.files[i].uri is an archive downloaded by
//     downloads.js into documents/bustaudio/<id>/. Extract lazily on first open
//     into pages-<i>/ INSIDE that folder (so deleteDownload / size accounting
//     keep working untouched), then delete the archive.
import * as FileSystem from "expo-file-system";
import { unzip } from "react-native-zip-archive";
import { getStreams } from "./api";
import { upsertBook } from "./library";
import { safe, dirSize } from "./downloads";

const ARCHIVE_EXTS = [".cbz", ".cbr", ".cb7", ".cbt", ".pdf"];
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"];

const CACHE_BASE = `${FileSystem.cacheDirectory}bustcomics`;

function extOf(name) {
  const m = String(name || "").toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : "";
}
function nameOf(stream) {
  return (stream && (stream.filename || stream.title)) || "";
}

export function isArchiveStream(s) {
  return ARCHIVE_EXTS.includes(extOf(nameOf(s)));
}
export function isImageStream(s) {
  return IMAGE_EXTS.includes(extOf(nameOf(s)));
}
export function isCbz(s) {
  return extOf(nameOf(s)) === ".cbz";
}
// What the in-app reader can open in v1: CBZ (zip) archives and loose images.
// CBR (rar) has no solid RN extractor — those stay download-only.
export function isReadable(s) {
  return isCbz(s) || isImageStream(s);
}

// Split a /app/streams result into a render plan for the detail screen.
export function classifyStreams(streams) {
  const list = streams || [];
  const archives = list.filter(isArchiveStream);
  const images = list.filter(isImageStream);
  // A torrent that's mostly loose pages may still carry a stray cover.jpg next
  // to its archives; archives win whenever present.
  if (archives.length > 0) return { mode: "archives", archives, images };
  return { mode: "images", archives, images };
}

// Natural-ordered page list: "page_2" before "page_10", junk filtered out.
export function sortPages(names) {
  return (names || [])
    .filter((n) => {
      const base = String(n).split("/").pop();
      if (!base || base.startsWith(".")) return false;
      if (/__MACOSX/i.test(n)) return false;
      return IMAGE_EXTS.includes(extOf(base));
    })
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
}

// ---- extracted-pages discovery ------------------------------------------------
// Archives often nest pages in a folder (or two); walk the tree and return every
// image, path-relative so sortPages keeps chapters in order.
async function listImagesRecursive(dirUri, prefix = "") {
  let names = [];
  try {
    names = await FileSystem.readDirectoryAsync(dirUri);
  } catch (_) {
    return [];
  }
  // Stat all entries of a directory concurrently — extracted volumes can hold
  // hundreds of pages and serial getInfoAsync calls would delay first render.
  const children = await Promise.all(
    names.map(async (n) => {
      const child = `${dirUri}/${encodeURIComponent(n)}`;
      const rel = prefix ? `${prefix}/${n}` : n;
      const info = await FileSystem.getInfoAsync(child).catch(() => null);
      if (info && info.isDirectory) return listImagesRecursive(child, rel);
      return [rel];
    })
  );
  return children.flat();
}

// Encode each path segment so spaces/# in scan filenames survive as image URIs.
function pageUri(baseUri, rel) {
  return `${baseUri}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

async function pagesFromDir(pagesDirUri) {
  const rels = sortPages(await listImagesRecursive(pagesDirUri));
  return rels.map((rel) => pageUri(pagesDirUri, rel));
}

// unzip() wants plain filesystem paths, not file:// URIs.
function toPath(uri) {
  return decodeURIComponent(String(uri).replace(/^file:\/\//, ""));
}

async function extractArchive(archiveUri, pagesDirUri) {
  await FileSystem.makeDirectoryAsync(pagesDirUri, { intermediates: true }).catch(() => {});
  try {
    await unzip(toPath(archiveUri), toPath(pagesDirUri));
  } catch (err) {
    await FileSystem.deleteAsync(pagesDirUri, { idempotent: true }).catch(() => {});
    throw new Error("Couldn't open this archive (corrupt or password-protected).");
  }
  const pages = await pagesFromDir(pagesDirUri);
  if (pages.length === 0) {
    await FileSystem.deleteAsync(pagesDirUri, { idempotent: true }).catch(() => {});
    throw new Error("No pages found inside this archive.");
  }
  return pages;
}

// ---- "Read now" (stream) path ---------------------------------------------------
// Download the archive into cache with progress, extract, drop the archive.
// onProgress({ phase: "download", written, total } | { phase: "extract" })
export async function prepareArchiveFromUrl(comic, stream, onProgress) {
  const dir = `${CACHE_BASE}/${safe(comic.id)}`;
  const pagesDir = `${dir}/pages-${safe(nameOf(stream))}`;

  // Re-opening a comic we already prepared: reuse the extracted pages.
  const existing = await pagesFromDir(pagesDir);
  if (existing.length > 0) return { pages: existing };

  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const archivePath = `${dir}/${safe(nameOf(stream) || "comic.cbz")}`;

  const fetchArchive = async (url) => {
    const dl = FileSystem.createDownloadResumable(url, archivePath, {}, (p) => {
      if (onProgress)
        onProgress({
          phase: "download",
          written: p.totalBytesWritten,
          total: p.totalBytesExpectedToWrite,
        });
    });
    const res = await dl.downloadAsync();
    if (!res || (res.status && res.status >= 400)) {
      throw new Error(`Download failed (HTTP ${res ? res.status : "?"})`);
    }
  };

  // Clear any leftover bytes from an earlier failed attempt so a fresh
  // download never lands on top of a partial file or an HTTP error body.
  await FileSystem.deleteAsync(archivePath, { idempotent: true }).catch(() => {});

  try {
    await fetchArchive(stream.url);
  } catch (err) {
    // TorBox requestdl links expire after a while — re-resolve once and retry
    // (same self-healing idea as player.js recoverStreams).
    const fresh = await getStreams(comic.id).catch(() => null);
    const again =
      fresh &&
      fresh.streams &&
      fresh.streams.find((s) => nameOf(s) === nameOf(stream) && s.url);
    if (!again) throw err;
    await FileSystem.deleteAsync(archivePath, { idempotent: true }).catch(() => {});
    await fetchArchive(again.url);
  }

  if (onProgress) onProgress({ phase: "extract" });
  const pages = await extractArchive(archivePath, pagesDir);
  await FileSystem.deleteAsync(archivePath, { idempotent: true }).catch(() => {});
  return { pages };
}

// ---- offline path ---------------------------------------------------------------
// entry.files[i].uri points at an archive that downloads.js saved. Extract it
// (once), persist the page list on the entry, delete the archive.
export async function ensureExtracted(entry, fileIndex = 0) {
  const f = entry.files && entry.files[fileIndex];
  if (!f) throw new Error("Nothing downloaded for this comic yet.");

  // Already extracted on a previous open?
  if (f.pages && f.pages.length > 0) return { pages: f.pages };

  const uri = f.uri;
  if (!uri || !/^file:/.test(uri)) throw new Error("This comic isn't downloaded.");

  // Loose-image download: the "files" ARE the pages. Filter + natural-sort
  // like every other page path, in case files were stored out of order.
  if (IMAGE_EXTS.includes(extOf(uri))) {
    const pages = sortPages(entry.files.map((x) => x.uri).filter(Boolean));
    return { pages };
  }

  const bookDir = uri.slice(0, uri.lastIndexOf("/"));
  const pagesDir = `${bookDir}/pages-${fileIndex}`;

  let pages = await pagesFromDir(pagesDir);
  if (pages.length === 0) {
    pages = await extractArchive(uri, pagesDir);
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }

  // Persist so later opens (and deletions) know about the extracted form.
  const files = entry.files.map((x, i) =>
    i === fileIndex ? { ...x, pages, extracted: true } : x
  );
  await upsertBook({ id: entry.id, files });
  return { pages };
}

// ---- cache maintenance (Settings) ------------------------------------------------
export async function clearComicCache() {
  await FileSystem.deleteAsync(CACHE_BASE, { idempotent: true }).catch(() => {});
}

export async function comicCacheSizeBytes() {
  return dirSize(CACHE_BASE);
}
