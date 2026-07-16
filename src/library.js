// src/library.js — local library (downloaded + in-progress books) and progress.
import AsyncStorage from "@react-native-async-storage/async-storage";

const LKEY = "bustaudio_library";

export async function getLibrary() {
  const s = await AsyncStorage.getItem(LKEY);
  return s ? JSON.parse(s) : {};
}
async function setLibrary(obj) {
  await AsyncStorage.setItem(LKEY, JSON.stringify(obj));
}

export async function upsertBook(entry) {
  const lib = await getLibrary();
  lib[entry.id] = { ...(lib[entry.id] || {}), ...entry };
  await setLibrary(lib);
  return lib[entry.id];
}

export async function getBook(id) {
  const lib = await getLibrary();
  return lib[id] || null;
}

// Entries saved before comics existed have no `type` — they're audiobooks.
export function typeOf(entry) {
  return entry && entry.type === "comic" ? "comic" : "audiobook";
}

export async function updateProgress(id, prog) {
  const lib = await getLibrary();
  if (!lib[id]) return;
  const now = Date.now();
  const stamped = { ...prog, lastPlayed: now };
  // Comic progress ({ page, totalPages }) also stamps lastRead for the
  // Continue Reading rail's sort order.
  if (prog.page != null) stamped.lastRead = now;
  lib[id].progress = { ...(lib[id].progress || {}), ...stamped };
  await setLibrary(lib);
}

export async function removeBook(id) {
  const lib = await getLibrary();
  delete lib[id];
  await setLibrary(lib);
}

export async function listBooks() {
  const lib = await getLibrary();
  return Object.values(lib);
}

// Books with saved progress, most-recent first (Continue Listening).
export async function continueListening() {
  const books = await listBooks();
  return books
    .filter((b) => typeOf(b) !== "comic")
    .filter((b) => b.progress && b.progress.position > 5 && !b.progress.finished)
    .sort((a, b) => (b.progress.lastPlayed || 0) - (a.progress.lastPlayed || 0));
}

// Comics with saved page progress, most-recent first (Continue Reading).
export async function continueReading() {
  const books = await listBooks();
  return books
    .filter((b) => typeOf(b) === "comic")
    .filter((b) => b.progress && b.progress.page > 0 && !b.progress.finished)
    .sort(
      (a, b) =>
        (b.progress.lastRead || b.progress.lastPlayed || 0) -
        (a.progress.lastRead || a.progress.lastPlayed || 0)
    );
}

// After wiping the download folder: clear flags/local files but keep listening
// progress, so books stay in Continue Listening and can be re-resolved.
export async function clearDownloadFlags() {
  const lib = await getLibrary();
  for (const id of Object.keys(lib)) {
    if (lib[id].downloaded) {
      delete lib[id].downloaded;
      delete lib[id].downloadedAt;
      lib[id].files = [];
    }
  }
  await setLibrary(lib);
}

// Same, but for one book (auto-delete finished, per-book cleanup).
export async function clearBookDownload(id) {
  const lib = await getLibrary();
  if (!lib[id]) return;
  delete lib[id].downloaded;
  delete lib[id].downloadedAt;
  lib[id].files = [];
  await setLibrary(lib);
}

// Downloaded but not yet finished (finished ones live in the Finished section).
export async function downloadedBooks() {
  const books = await listBooks();
  return books
    .filter((b) => b.downloaded && !(b.progress && b.progress.finished))
    .sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0));
}

// Books listened to the end, most recent first.
export async function finishedBooks() {
  const books = await listBooks();
  return books
    .filter((b) => b.progress && b.progress.finished)
    .sort((a, b) => (b.progress.lastPlayed || 0) - (a.progress.lastPlayed || 0));
}

// ---- bookmarks ---------------------------------------------------------------
// bm: { position, trackIndex, createdAt }
export async function addBookmark(book, bm) {
  const lib = await getLibrary();
  const entry = lib[book.id] || { id: book.id, title: book.title, author: book.author, poster: book.poster };
  entry.bookmarks = [...(entry.bookmarks || []), bm].sort(
    (a, b) => a.trackIndex - b.trackIndex || a.position - b.position
  );
  lib[book.id] = entry;
  await setLibrary(lib);
  return entry.bookmarks;
}

export async function removeBookmark(id, createdAt) {
  const lib = await getLibrary();
  if (!lib[id]) return [];
  lib[id].bookmarks = (lib[id].bookmarks || []).filter((b) => b.createdAt !== createdAt);
  await setLibrary(lib);
  return lib[id].bookmarks;
}
