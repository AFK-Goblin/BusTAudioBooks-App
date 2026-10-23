// src/downloads.js
// Offline downloads via a NATIVE background downloader (survives screen lock).
//
// IMPORTANT: every URL here comes from the backend's /app/streams response, which
// only ever returns TorBox `requestdl` links. We additionally refuse anything
// that isn't HTTPS — so downloads always go THROUGH TORBOX, never direct.
//
// Jobs are persisted to AsyncStorage so that if Android kills the app mid-
// download, resumePendingDownloads() (called at boot) can re-attach to the
// native tasks — or restart what's missing — and still finish the book.
//
// File access MUST come from "expo-file-system/legacy". Since SDK 54 the root
// "expo-file-system" export of getInfoAsync/deleteAsync/... is a stub that
// throws at runtime, and every call here is wrapped in .catch() — so the
// breakage was silent: deletes freed nothing and storage always read 0 B.
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createDownloadTask,
  getExistingDownloadTasks,
  completeHandler,
  directories,
  setConfig,
} from "@kesha-antonov/react-native-background-downloader";
import { createNativeDownload } from "./downloads/adapter";
import { upsertBook, finishedBooks, clearBookDownload, getBook, getLibrary, removeBooks } from "./library";
import { startTracking, reportProgress, finishTracking, failTracking, dismissTracking } from "./downloadStore";
import { showToast } from "./toast";
import { getSettings } from "./settings";
import { getStreams } from "./api";

const BASE = directories.documents;
const BASE_URI = BASE.startsWith("file://") ? BASE : "file://" + BASE;
const JKEY = "bustaudio_dljobs";

export function safe(s) {
  return String(s).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
}

// FNV-1a, 32-bit: a short, stable fingerprint of a full item id.
function fingerprint(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Folder (under documents/bustaudio/) that holds one item's files. Builds
// before 3.1 used safe(id) alone, which truncates at 80 chars: ids without an
// infohash (hashless Jackett links) share that prefix, so different books
// landed in one folder and deleting either deleted both. Long ids now get a
// fingerprint suffix. Folders written by older builds keep working because
// entries record `storageDir` and old jobs fall back to legacyDirFor().
export function storageDirFor(id) {
  const plain = safe(id);
  return String(id).length <= 80 ? plain : `${plain.slice(0, 64)}-${fingerprint(id)}`;
}
const legacyDirFor = safe;

// The folder(s) a library entry's files live in: the recorded storageDir, or
// whatever folder its file URIs point into (pre-3.1 downloads).
export function storageDirsOf(entry) {
  if (!entry) return [];
  if (entry.storageDir) return [entry.storageDir];
  const prefix = `${BASE_URI}/bustaudio/`;
  const dirs = new Set();
  for (const f of entry.files || []) {
    const uri = typeof f === "object" && f ? f.uri : null;
    if (typeof uri !== "string" || !uri.startsWith(prefix)) continue;
    const dir = uri.slice(prefix.length).split("/")[0];
    if (dir) dirs.add(dir);
  }
  if (dirs.size === 0 && entry.downloaded && entry.id) dirs.add(legacyDirFor(entry.id));
  return [...dirs];
}

// ---- pending-job persistence ------------------------------------------------
// Same read-modify-write hazard as library.js: two downloads starting together
// would each read the old job map and the second write would drop the first.
let jobQueue = Promise.resolve();
function lockedJobs(fn) {
  const run = jobQueue.then(fn, fn);
  jobQueue = run.then(() => {}, () => {});
  return run;
}
async function loadJobs() {
  try {
    const s = await AsyncStorage.getItem(JKEY);
    return s ? JSON.parse(s) : {};
  } catch (_) {
    return {};
  }
}
function saveJob(book, files, dir) {
  return lockedJobs(async () => {
    const jobs = await loadJobs();
    jobs[book.id] = { book, files, dir };
    await AsyncStorage.setItem(JKEY, JSON.stringify(jobs)).catch(() => {});
  });
}
function removeJob(id) {
  return lockedJobs(async () => {
    const jobs = await loadJobs();
    if (jobs[id] == null) return;
    delete jobs[id];
    await AsyncStorage.setItem(JKEY, JSON.stringify(jobs)).catch(() => {});
  });
}

// ---- task plumbing ----------------------------------------------------------
function parseProgress(a, b, c) {
  // The lib emits either ({bytesDownloaded, bytesTotal}) or (percent, written, total).
  if (a && typeof a === "object") return [a.bytesDownloaded, a.bytesTotal];
  return [b, c];
}

// ---- notifications ------------------------------------------------------------
// Android shows a notification per transfer (required on Android 14+). By
// default the downloader keeps it minimal and silent; this turns it into a
// real one — book title, part, progress — with a Cancel button. Completion
// notifications stay off: they fire per FILE (forty for a forty-part book)
// and open the raw file in another app.
let notificationsConfigured = false;
function configureNotifications() {
  if (notificationsConfigured || typeof setConfig !== "function") return;
  notificationsConfigured = true;
  try {
    setConfig({
      showNotificationsEnabled: true,
      showCancelAction: true,
      showCompletionNotification: false,
      notificationsGrouping: { enabled: true, mode: "individual" },
    });
  } catch (_) {
    /* notifications are a nicety; downloads work without them */
  }
}

// The notification's Cancel button stops the transfer natively and reports
// it as an error with this code.
const NOTIFICATION_CANCEL_CODE = -1;

// ---- cancellation -------------------------------------------------------------
// The native task can be stopped, but nothing promises a done/error callback
// afterwards — so a cancel settles the waiting promise itself.
export class DownloadCancelled extends Error {
  constructor() {
    super("Download cancelled");
    this.name = "DownloadCancelled";
  }
}
const running = new Set(); // book ids with a download loop in progress
const cancelled = new Set(); // ...that were asked to stop
const inFlight = new Map(); // book id -> { task, cancel } for the file transferring now

// Settles once; registers the native task so cancelDownload() can reach it.
function settleOnce(bookId, resolve, reject) {
  let settled = false;
  const finish = (fn) => (value) => {
    if (settled) return;
    settled = true;
    inFlight.delete(bookId);
    fn(value);
  };
  return {
    resolve: finish(resolve),
    reject: finish(reject),
    register: (task) => {
      if (!settled) inFlight.set(bookId, { task, cancel: finish(reject) });
    },
  };
}

function runTask(id, url, destination, onProgress, bookId, notificationTitle) {
  // Wi-Fi-only: metered connections (mobile data) are refused by the OS
  // downloader itself, so the setting holds even with the app backgrounded.
  const wifiOnly = !!getSettings().wifiOnly;
  configureNotifications();
  return new Promise((resolve, reject) => {
    const settle = settleOnce(bookId, resolve, reject);
    let task;
    task = createNativeDownload(createDownloadTask, {
      id,
      url,
      destination,
      isAllowedOverMetered: !wifiOnly,
      isAllowedOverRoaming: !wifiOnly,
      metadata: { notificationTitle, groupId: bookId },
    }, {
      begin: () => {},
      progress: (a, b, c) => {
        const [written, total] = parseProgress(a, b, c);
        if (onProgress) onProgress(written || 0, total || 0);
      },
      done: () => {
        try { completeHandler(task.id); } catch (_) {}
        settle.resolve();
      },
      error: (e) => {
        try { completeHandler(task.id); } catch (_) {}
        settle.reject(failure(e, bookId));
      },
    });
    settle.register(task);
  });
}

// A native error, or the notification's Cancel button (treated exactly like
// the Library's ✕: the book's download stops and its partial files go).
function failure(e, bookId) {
  if (e && e.errorCode === NOTIFICATION_CANCEL_CODE) {
    cancelled.add(bookId);
    return new DownloadCancelled();
  }
  return new Error((e && (e.error || e.errorCode)) || "Download failed");
}

// Re-attach handlers to a task recovered by checkForExistingDownloads().
function attachTask(task, onProgress, bookId) {
  return new Promise((resolve, reject) => {
    if (task.state === "DONE") {
      try { completeHandler(task.id); } catch (_) {}
      resolve();
      return;
    }
    const settle = settleOnce(bookId, resolve, reject);
    settle.register(task);
    task
      .progress((a, b, c) => {
        const [written, total] = parseProgress(a, b, c);
        if (onProgress) onProgress(written || 0, total || 0);
      })
      .done(() => {
        try { completeHandler(task.id); } catch (_) {}
        settle.resolve();
      })
      .error((e) => {
        try { completeHandler(task.id); } catch (_) {}
        settle.reject(failure(e, bookId));
      });
    if (task.state === "PAUSED") {
      try { task.resume(); } catch (_) {}
    }
  });
}

// Stops a book's download, deletes what it had fetched, and forgets it.
// Finished files of a cancelled download are removed too: a half book is
// not something the Library can play.
export async function cancelDownload(id) {
  if (!running.has(id)) {
    // Nothing transferring (e.g. a failed entry): just clear it away.
    dismissTracking(id);
    await removeJob(id);
    return;
  }
  cancelled.add(id);
  const active = inFlight.get(id);
  if (active) {
    try { await active.task.stop(); } catch (_) {}
    active.cancel(new DownloadCancelled());
  }
}

function notificationTitle(book, index, count) {
  const title = book.title || "Audiobook";
  return count > 1 ? `${title} — part ${index + 1} of ${count}` : title;
}

// ---- book download core ------------------------------------------------------
// existingTasks: Map(taskId -> recovered task) when resuming after an app kill,
// null for a fresh download. resuming also skips files already fully on disk.
async function runBookDownload(book, files, existingTasks, onProgress, dir = storageDirFor(book.id)) {
  running.add(book.id);
  startTracking(book.id, { title: book.title, poster: book.poster, count: files.length, book, files });
  const rel = "bustaudio/" + dir;
  await FileSystem.makeDirectoryAsync(`${BASE_URI}/${rel}`, { intermediates: true }).catch(() => {});

  try {
    const localFiles = [];
    for (let i = 0; i < files.length; i++) {
      if (cancelled.has(book.id)) throw new DownloadCancelled();
      const f = files[i];
      const name = safe(f.filename || `part-${String(i + 1).padStart(3, "0")}`);
      const destination = `${BASE}/${rel}/${name}`;
      // Native task ids are what a resumed job re-attaches by — they must stay
      // derived from the folder the job was started with.
      const taskId = `${dir}-${i}`;
      let fileBytes = 0;
      const prog = (written, total) => {
        if (total) fileBytes = total;
        reportProgress(book.id, i, files.length, written, total);
        if (onProgress) onProgress(i, files.length, written, total);
      };

      const existing = existingTasks && existingTasks.get(taskId);
      if (existing) {
        await attachTask(existing, prog, book.id);
      } else if (existingTasks) {
        // Resuming, but the OS no longer knows this task: a file already on
        // disk finished while we were dead; anything else gets re-downloaded.
        const info = await FileSystem.getInfoAsync(`${BASE_URI}/${rel}/${name}`, { size: true }).catch(() => null);
        if (!(info && info.exists && info.size > 0)) {
          await runTask(taskId, f.url, destination, prog, book.id, notificationTitle(book, i, files.length));
        } else {
          fileBytes = info.size;
        }
      } else {
        await runTask(taskId, f.url, destination, prog, book.id, notificationTitle(book, i, files.length));
      }
      if (cancelled.has(book.id)) throw new DownloadCancelled();
      // filename + size travel with the local copy: size drives whole-book
      // progress for multi-part books, filename keeps the format visible.
      const size = f.size || fileBytes;
      localFiles.push({
        title: f.title,
        uri: `file://${destination}`,
        ...(f.filename ? { filename: f.filename } : {}),
        ...(size > 0 ? { size } : {}),
      });
    }

    const entry = await upsertBook({
      ...book,
      files: localFiles,
      downloaded: true,
      downloadedAt: Date.now(),
      storageDir: dir,
    });
    finishTracking(book.id);
    showToast(`Downloaded “${book.title}” — it plays offline now`);
    await removeJob(book.id);
    return entry;
  } catch (err) {
    if (err instanceof DownloadCancelled || cancelled.has(book.id)) {
      dismissTracking(book.id);
      await removeJob(book.id);
      // Drop the partial files — unless the folder belongs to a copy that is
      // already downloaded (never delete a finished download by accident).
      const owner = await getBook(book.id).catch(() => null);
      if (!(owner && owner.downloaded)) {
        await FileSystem.deleteAsync(`${BASE_URI}/${rel}`, { idempotent: true }).catch(() => {});
      }
      throw err instanceof DownloadCancelled ? err : new DownloadCancelled();
    }
    failTracking(book.id, err.message);
    await removeJob(book.id);
    throw err;
  } finally {
    running.delete(book.id);
    cancelled.delete(book.id);
    inFlight.delete(book.id);
  }
}

// files: [{ title, url, filename }]
// onProgress(fileIndex, fileCount, writtenBytes, totalBytes)  (optional)
export async function downloadBook(book, files, onProgress) {
  // Safety: only ever download TorBox HTTPS links.
  for (const f of files) {
    if (!/^https:\/\//i.test(f.url || "")) {
      throw new Error("Refusing a non-HTTPS link (downloads must go through TorBox).");
    }
  }
  // A second loop for the same book would fight the first over its task ids.
  if (running.has(book.id)) throw new Error("This is already downloading.");
  const dir = storageDirFor(book.id);
  await saveJob(book, files, dir);
  return runBookDownload(book, files, null, onProgress, dir);
}

// Fire-and-forget: start a download and let the global store track it, so the
// user can navigate away and still watch progress in the Library.
export function startDownload(book, files) {
  downloadBook(book, files).catch(() => {});
}

// Retry a failed download. TorBox links expire, and a download that failed
// late was usually started long ago — so ask the server for fresh links first
// (matched by filename, else position) and fall back to the stored ones if
// that fails. Finished parts are simply downloaded again into the same folder.
export async function retryDownload(entry) {
  if (!entry || !entry.book || !entry.files) return;
  dismissTracking(entry.id);
  startDownload(entry.book, await freshLinks(entry.book.id, entry.files));
}

async function freshLinks(bookId, files) {
  try {
    const result = await getStreams(bookId);
    const streams = result && result.ready && Array.isArray(result.streams) ? result.streams : [];
    if (streams.length === 0) return files;
    const byName = new Map(streams.filter((s) => s.filename).map((s) => [s.filename, s.url]));
    const sameShape = streams.length === files.length;
    return files.map((f, i) => {
      const url = (f.filename && byName.get(f.filename)) || (sameShape ? streams[i].url : null);
      return url && /^https:\/\//i.test(url) ? { ...f, url } : f;
    });
  } catch (_) {
    return files;
  }
}

// Called once at boot: finish any book whose download the OS carried on with
// (or that stalled) while the app was dead.
export async function resumePendingDownloads() {
  configureNotifications();
  const jobs = await loadJobs();
  const ids = Object.keys(jobs);
  if (ids.length === 0) return;
  let tasks = [];
  try {
    tasks = await getExistingDownloadTasks();
  } catch (_) {}
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const id of ids) {
    const { book, files, dir } = jobs[id] || {};
    if (!book || !files) {
      removeJob(id);
      continue;
    }
    if (book.type === "comic") {
      // Comics were removed: don't finish their downloads. Stop the native
      // transfers; removeComicsData() deletes what already arrived.
      const prefix = `${dir || legacyDirFor(book.id)}-`;
      for (const task of tasks) {
        if (String(task.id).startsWith(prefix)) {
          try { await task.stop(); } catch (_) {}
        }
      }
      await removeJob(id);
      continue;
    }
    // Jobs saved by pre-3.1 builds have no dir: their files and native task
    // ids use the legacy folder name.
    runBookDownload(book, files, byId, undefined, dir || legacyDirFor(book.id)).catch(() => {});
  }
}

// Deletes an item's downloaded files. Call BEFORE clearing the entry's files,
// since older downloads are located through their stored file URIs.
export async function deleteDownload(id) {
  const entry = await getBook(id).catch(() => null);
  const dirs = entry ? storageDirsOf(entry) : [legacyDirFor(id)];
  for (const dir of dirs) {
    await FileSystem.deleteAsync(`${BASE_URI}/bustaudio/${dir}`, { idempotent: true }).catch(() => {});
  }
}

// Folders under bustaudio/ that nothing owns any more. 3.0.x could not delete
// files (see the import note at the top), so "removed" downloads and
// auto-deleted finished books stayed on disk. Run at boot; reclaims that space.
export async function sweepOrphanedDownloads() {
  let names;
  try {
    names = await FileSystem.readDirectoryAsync(`${BASE_URI}/bustaudio`);
  } catch (_) {
    return 0; // no downloads folder yet
  }
  // If the library can't be read, owning entries are unknown: delete nothing.
  const lib = await getLibrary();
  const jobs = await loadJobs();
  const owned = new Set();
  for (const entry of Object.values(lib)) {
    if (entry && entry.downloaded) storageDirsOf(entry).forEach((d) => owned.add(d));
  }
  for (const [id, job] of Object.entries(jobs)) {
    owned.add((job && job.dir) || legacyDirFor(id));
    owned.add(storageDirFor(id));
  }
  let removed = 0;
  for (const name of names) {
    if (owned.has(name)) continue;
    await FileSystem.deleteAsync(`${BASE_URI}/bustaudio/${name}`, { idempotent: true }).catch(() => {});
    removed++;
  }
  return removed;
}

export async function dirSize(uri) {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    if (!info.exists) return 0;
    if (!info.isDirectory) return info.size || 0;
    // Siblings in parallel: a multi-part book is hundreds of files, and one
    // native call at a time left Settings showing "…" for seconds.
    const names = await FileSystem.readDirectoryAsync(uri);
    const sizes = await Promise.all(names.map((n) => dirSize(`${uri}/${n}`)));
    return sizes.reduce((total, size) => total + size, 0);
  } catch (_) {
    return 0;
  }
}

// What each downloaded book takes on disk, largest first: [{ entry, bytes }].
export async function downloadSizes() {
  const lib = await getLibrary();
  const entries = Object.values(lib).filter((e) => e && e.downloaded && e.type !== "comic");
  const sized = await Promise.all(entries.map(async (entry) => {
    const sizes = await Promise.all(storageDirsOf(entry).map((dir) => dirSize(`${BASE_URI}/bustaudio/${dir}`)));
    return { entry, bytes: sizes.reduce((total, size) => total + size, 0) };
  }));
  return sized.sort((a, b) => b.bytes - a.bytes);
}

// Total bytes used by all downloaded books (for the Settings screen).
export async function downloadsSizeBytes() {
  return dirSize(`${BASE_URI}/bustaudio`);
}

export async function deleteAllDownloads() {
  await FileSystem.deleteAsync(`${BASE_URI}/bustaudio`, { idempotent: true }).catch(() => {});
}

// "Auto-delete finished" sweep, run at boot: frees the files of books that have
// been listened to the end. Progress (and the library entry) is kept.
export async function sweepFinishedDownloads() {
  const done = (await finishedBooks()).filter((b) => b.downloaded);
  for (const b of done) {
    await deleteDownload(b.id);
    await clearBookDownload(b.id);
  }

}

// ---- comics removal ------------------------------------------------------------
// Comics were removed from the app. Older versions could leave comic entries
// (torrent comics, MangaDex series and chapter downloads), their files, a
// read-now cache and search history; without the feature none of it can be
// opened, so it goes — once, at the first launch of a build without comics.
const COMICS_REMOVED_KEY = "bustaudio_comics_removed";

export async function removeComicsData() {
  if (await AsyncStorage.getItem(COMICS_REMOVED_KEY).catch(() => null)) return 0;
  const lib = await getLibrary();
  const comics = Object.values(lib).filter((b) => b && b.type === "comic");
  for (const entry of comics) {
    for (const dir of storageDirsOf(entry)) {
      await FileSystem.deleteAsync(`${BASE_URI}/bustaudio/${dir}`, { idempotent: true }).catch(() => {});
    }
  }
  await removeBooks(comics.map((b) => b.id));
  const jobs = await loadJobs();
  for (const [id, job] of Object.entries(jobs)) {
    if (job && job.book && job.book.type === "comic") await removeJob(id);
  }
  if (FileSystem.cacheDirectory) {
    await FileSystem.deleteAsync(`${FileSystem.cacheDirectory}bustcomics`, { idempotent: true }).catch(() => {});
  }
  await AsyncStorage.multiRemove(["bustaudio_recent_manga", "bustaudio_recent_comics"]).catch(() => {});
  await AsyncStorage.setItem(COMICS_REMOVED_KEY, JSON.stringify({ at: Date.now(), removed: comics.length })).catch(() => {});
  return comics.length;
}
