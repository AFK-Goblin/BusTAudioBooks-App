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
import * as FileSystem from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  download,
  checkForExistingDownloads,
  completeHandler,
  directories,
} from "@kesha-antonov/react-native-background-downloader";
import { upsertBook, finishedBooks, clearBookDownload } from "./library";
import { startTracking, reportProgress, finishTracking, failTracking, dismissTracking } from "./downloadStore";
import { getSettings } from "./settings";

const BASE = directories.documents;
const BASE_URI = BASE.startsWith("file://") ? BASE : "file://" + BASE;
const JKEY = "bustaudio_dljobs";

function safe(s) {
  return String(s).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
}

// ---- pending-job persistence ------------------------------------------------
async function loadJobs() {
  try {
    const s = await AsyncStorage.getItem(JKEY);
    return s ? JSON.parse(s) : {};
  } catch (_) {
    return {};
  }
}
async function saveJob(book, files) {
  const jobs = await loadJobs();
  jobs[book.id] = { book, files };
  await AsyncStorage.setItem(JKEY, JSON.stringify(jobs)).catch(() => {});
}
async function removeJob(id) {
  const jobs = await loadJobs();
  if (jobs[id] == null) return;
  delete jobs[id];
  await AsyncStorage.setItem(JKEY, JSON.stringify(jobs)).catch(() => {});
}

// ---- task plumbing ----------------------------------------------------------
function parseProgress(a, b, c) {
  // The lib emits either ({bytesDownloaded, bytesTotal}) or (percent, written, total).
  if (a && typeof a === "object") return [a.bytesDownloaded, a.bytesTotal];
  return [b, c];
}

function runTask(id, url, destination, onProgress) {
  // Wi-Fi-only: metered connections (mobile data) are refused by the OS
  // downloader itself, so the setting holds even with the app backgrounded.
  const wifiOnly = !!getSettings().wifiOnly;
  return new Promise((resolve, reject) => {
    const task = download({
      id,
      url,
      destination,
      isAllowedOverMetered: !wifiOnly,
      isAllowedOverRoaming: !wifiOnly,
    })
      .begin(() => {})
      .progress((a, b, c) => {
        const [written, total] = parseProgress(a, b, c);
        if (onProgress) onProgress(written || 0, total || 0);
      })
      .done(() => {
        try { completeHandler(task.id); } catch (_) {}
        resolve();
      })
      .error((e) => {
        try { completeHandler(task.id); } catch (_) {}
        reject(new Error((e && (e.error || e.errorCode)) || "Download failed"));
      });
  });
}

// Re-attach handlers to a task recovered by checkForExistingDownloads().
function attachTask(task, onProgress) {
  return new Promise((resolve, reject) => {
    if (task.state === "DONE") {
      try { completeHandler(task.id); } catch (_) {}
      resolve();
      return;
    }
    task
      .progress((a, b, c) => {
        const [written, total] = parseProgress(a, b, c);
        if (onProgress) onProgress(written || 0, total || 0);
      })
      .done(() => {
        try { completeHandler(task.id); } catch (_) {}
        resolve();
      })
      .error((e) => {
        try { completeHandler(task.id); } catch (_) {}
        reject(new Error((e && (e.error || e.errorCode)) || "Download failed"));
      });
    if (task.state === "PAUSED") {
      try { task.resume(); } catch (_) {}
    }
  });
}

// ---- book download core ------------------------------------------------------
// existingTasks: Map(taskId -> recovered task) when resuming after an app kill,
// null for a fresh download. resuming also skips files already fully on disk.
async function runBookDownload(book, files, existingTasks, onProgress) {
  startTracking(book.id, { title: book.title, poster: book.poster, count: files.length, book, files });
  const rel = "bustaudio/" + safe(book.id);
  await FileSystem.makeDirectoryAsync(`${BASE_URI}/${rel}`, { intermediates: true }).catch(() => {});

  try {
    const localFiles = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const name = safe(f.filename || `part-${String(i + 1).padStart(3, "0")}`);
      const destination = `${BASE}/${rel}/${name}`;
      const taskId = `${safe(book.id)}-${i}`;
      const prog = (written, total) => {
        reportProgress(book.id, i, files.length, written, total);
        if (onProgress) onProgress(i, files.length, written, total);
      };

      const existing = existingTasks && existingTasks.get(taskId);
      if (existing) {
        await attachTask(existing, prog);
      } else if (existingTasks) {
        // Resuming, but the OS no longer knows this task: a file already on
        // disk finished while we were dead; anything else gets re-downloaded.
        const info = await FileSystem.getInfoAsync(`${BASE_URI}/${rel}/${name}`, { size: true }).catch(() => null);
        if (!(info && info.exists && info.size > 0)) {
          await runTask(taskId, f.url, destination, prog);
        }
      } else {
        await runTask(taskId, f.url, destination, prog);
      }
      localFiles.push({ title: f.title, uri: `file://${destination}` });
    }

    const entry = await upsertBook({
      ...book,
      files: localFiles,
      downloaded: true,
      downloadedAt: Date.now(),
    });
    finishTracking(book.id);
    await removeJob(book.id);
    return entry;
  } catch (err) {
    failTracking(book.id, err.message);
    await removeJob(book.id);
    throw err;
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
  await saveJob(book, files);
  return runBookDownload(book, files, null, onProgress);
}

// Fire-and-forget: start a download and let the global store track it, so the
// user can navigate away and still watch progress in the Library.
export function startDownload(book, files) {
  downloadBook(book, files).catch(() => {});
}

// Retry a failed download using the book/files stashed in the store entry.
export function retryDownload(entry) {
  if (!entry || !entry.book || !entry.files) return;
  dismissTracking(entry.id);
  startDownload(entry.book, entry.files);
}

// Called once at boot: finish any book whose download the OS carried on with
// (or that stalled) while the app was dead.
export async function resumePendingDownloads() {
  const jobs = await loadJobs();
  const ids = Object.keys(jobs);
  if (ids.length === 0) return;
  let tasks = [];
  try {
    tasks = await checkForExistingDownloads();
  } catch (_) {}
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const id of ids) {
    const { book, files } = jobs[id] || {};
    if (!book || !files) {
      removeJob(id);
      continue;
    }
    runBookDownload(book, files, byId).catch(() => {});
  }
}

export async function deleteDownload(id) {
  const dir = `${BASE_URI}/bustaudio/${safe(id)}`;
  await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => {});
}

async function dirSize(uri) {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    if (!info.exists) return 0;
    if (!info.isDirectory) return info.size || 0;
    const names = await FileSystem.readDirectoryAsync(uri);
    let total = 0;
    for (const n of names) total += await dirSize(`${uri}/${n}`);
    return total;
  } catch (_) {
    return 0;
  }
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
