// src/library.js — local library (downloaded + in-progress books) and progress.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ACCOUNT_FIELDS, projectBook, sameBook, isAccountId } from "./accounts/projection";

const LKEY = "bustaudio_library";

export async function getLibrary() {
  const s = await AsyncStorage.getItem(LKEY);
  return s ? JSON.parse(s) : {};
}
async function setLibrary(obj) {
  await AsyncStorage.setItem(LKEY, JSON.stringify(obj));
}

// Every mutation below is a read-modify-write cycle on ONE storage blob. Two
// running concurrently (e.g. a playback checkpoint and a bookmark) would each
// read the same snapshot and the second write would silently revert the first.
// Serialize them all through one queue.
let writeQueue = Promise.resolve();
function locked(fn) {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(() => {}, () => {});
  return run;
}

export function upsertBook(entry) {
  return locked(async () => {
    const lib = await getLibrary();
    lib[entry.id] = { ...(lib[entry.id] || {}), ...entry };
    await setLibrary(lib);
    return lib[entry.id];
  });
}

export async function getBook(id) {
  const lib = await getLibrary();
  return lib[id] || null;
}

// PlaybackSession's single checkpoint pipeline uses this named boundary so
// foreground and background callers cannot grow separate persistence paths.
//
// It also learns each part's duration as the player reports it, building
// progress.trackDurations so multi-part books get whole-book progress.
export function checkpointAudiobookProgress(id, progress) {
  return locked(async () => {
    const lib = await getLibrary();
    if (!lib[id]) return;
    const previous = lib[id].progress || {};
    const durations = Array.isArray(previous.trackDurations) ? [...previous.trackDurations] : [];
    const index = progress.trackIndex;
    if (Number.isInteger(index) && index >= 0 && index < 10000 && Number.isFinite(progress.duration) && progress.duration > 0) {
      while (durations.length < index) durations.push(null);
      durations[index] = progress.duration;
    }
    lib[id].progress = {
      ...previous,
      ...progress,
      ...(durations.length ? { trackDurations: durations } : {}),
      lastPlayed: Date.now(),
    };
    await setLibrary(lib);
  });
}

// ---- per-book metadata ----------------------------------------------------------
// Bulky, write-once data lives under its own key per book, NOT in the library
// blob: that blob is re-read and rewritten on every playback checkpoint, and
// Android's AsyncStorage can't read a single value much past 2 MB. Written
// only for books in the library; removeBook() deletes it with the entry.
const chaptersKey = (id) => `bustaudio_chapters:${id}`;
const detailsKey = (id) => `bustaudio_details:${id}`;
export const seriesKey = (id) => `bustaudio_series:${id}`;
export const similarKey = (id) => `bustaudio_similar:${id}`;

async function readKey(key) {
  try {
    const s = await AsyncStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch (_) {
    return null;
  }
}

// Embedded chapter markers read from a book's files (see src/chapters), keyed
// by part index + filename, so they survive files[] being swapped when a book
// moves between streaming and downloaded.
export async function getEmbeddedChapters(id) {
  return (await readKey(chaptersKey(id))) || {};
}
export function saveEmbeddedChapters(id, key, value) {
  return locked(async () => {
    const lib = await getLibrary();
    if (!lib[id]) return;
    const current = await getEmbeddedChapters(id);
    await AsyncStorage.setItem(chaptersKey(id), JSON.stringify({ ...current, [key]: value }));
  });
}

// Book-page details (synopsis, genre, year), so downloaded books show them offline.
export function getSavedDetails(id) {
  return readKey(detailsKey(id));
}
export function saveDetails(id, details) {
  return locked(async () => {
    const lib = await getLibrary();
    if (!lib[id]) return;
    await AsyncStorage.setItem(detailsKey(id), JSON.stringify(details));
  });
}

// "Mark as finished" / "Mark as unfinished" from the Library menu. Keeps the
// position, so un-finishing returns the book to Continue Listening.
export function setFinished(id, finished) {
  return locked(async () => {
    const lib = await getLibrary();
    if (!lib[id]) return;
    lib[id].progress = { ...(lib[id].progress || {}), finished: !!finished, lastPlayed: Date.now() };
    await setLibrary(lib);
  });
}

// Your 1–5 star rating of a book (0 clears it).
export function setRating(id, rating) {
  return locked(async () => {
    const lib = await getLibrary();
    if (!lib[id]) return null;
    const stars = Math.max(0, Math.min(5, Math.round(rating) || 0));
    if (stars) lib[id].rating = stars;
    else delete lib[id].rating;
    await setLibrary(lib);
    return lib[id];
  });
}

// Back to the start. Learned part durations and the book's own speed survive
// — they describe the files and how you like to listen, not where you were.
export function resetProgress(id) {
  return locked(async () => {
    const lib = await getLibrary();
    if (!lib[id]) return;
    const { trackDurations, rate } = lib[id].progress || {};
    lib[id].progress = {
      position: 0, trackIndex: 0, finished: false,
      ...(trackDurations ? { trackDurations } : {}),
      ...(rate ? { rate } : {}),
    };
    await setLibrary(lib);
  });
}

export function removeBook(id) {
  return locked(async () => {
    const lib = await getLibrary();
    delete lib[id];
    await setLibrary(lib);
    await AsyncStorage.multiRemove([chaptersKey(id), detailsKey(id), seriesKey(id), similarKey(id)]).catch(() => {});
  });
}

// Restoring a backup (src/backup.js). Books not on this phone are added
// (they re-resolve when played); for books already here the more recently
// played progress wins and bookmarks are combined. Safe to repeat.
export function mergeBackupBooks(books) {
  return locked(async () => {
    const lib = await getLibrary();
    let added = 0;
    let updated = 0;
    for (const b of books) {
      const existing = lib[b.id];
      if (!existing) {
        lib[b.id] = {
          id: b.id, title: b.title, files: [],
          ...(b.author ? { author: b.author } : {}), ...(b.poster ? { poster: b.poster } : {}), ...(b.format ? { format: b.format } : {}),
          ...(b.progress ? { progress: b.progress } : {}),
          ...(Array.isArray(b.bookmarks) ? { bookmarks: b.bookmarks } : {}),
          ...(b.saved ? { saved: true, savedAt: b.savedAt || 0 } : {}),
          ...(b.rating ? { rating: b.rating } : {}),
        };
        added++;
        continue;
      }
      const mine = existing.progress || {};
      const theirs = b.progress || {};
      const newer = b.progress && (theirs.lastPlayed || 0) > (mine.lastPlayed || 0);
      const marks = new Map((existing.bookmarks || []).map((m) => [m.createdAt, m]));
      let gained = false;
      for (const m of b.bookmarks || []) {
        if (!marks.has(m.createdAt)) { marks.set(m.createdAt, m); gained = true; }
      }
      const gainedSaved = !!b.saved && !existing.saved;
      const gainedRating = !!b.rating && !existing.rating;
      if (!newer && !gained && !gainedSaved && !gainedRating) continue;
      lib[b.id] = {
        ...existing,
        ...(gainedSaved ? { saved: true, savedAt: b.savedAt || 0 } : {}),
        ...(gainedRating ? { rating: b.rating } : {}),
        ...(newer ? { progress: { ...mine, ...theirs } } : {}),
        bookmarks: [...marks.values()].sort((x, y) => (x.trackIndex || 0) - (y.trackIndex || 0) || (x.position || 0) - (y.position || 0)),
      };
      updated++;
    }
    await setLibrary(lib);
    return { added, updated };
  });
}

// "Want to Listen": a book saved from search for later. Saving makes a small
// library entry (no files) if there isn't one; un-saving deletes that entry
// again unless it has picked up anything worth keeping.
export function setSaved(item, saved) {
  return locked(async () => {
    const lib = await getLibrary();
    const existing = lib[item.id];
    if (saved) {
      lib[item.id] = {
        id: item.id, title: item.title, files: [],
        ...(item.author ? { author: item.author } : {}), ...(item.poster ? { poster: item.poster } : {}), ...(item.format ? { format: item.format } : {}),
        ...(existing || {}),
        saved: true, savedAt: Date.now(),
      };
    } else if (existing) {
      const { saved: _saved, savedAt: _at, ...rest } = existing;
      if (isBare(rest)) {
        delete lib[item.id];
        await AsyncStorage.multiRemove([chaptersKey(item.id), detailsKey(item.id)]).catch(() => {});
      } else {
        lib[item.id] = rest;
      }
    }
    await setLibrary(lib);
    return lib[item.id] || null;
  });
}

// Nothing but a title: never played or streamed, no download, no bookmarks.
function isBare(entry) {
  const p = entry.progress || {};
  return !entry.downloaded && !(entry.files && entry.files.length) && !(entry.bookmarks && entry.bookmarks.length)
    && !p.finished && !(p.position > 5) && !(p.trackIndex > 0);
}

// Several entries in one write (the comics cleanup can drop hundreds).
export function removeBooks(ids) {
  return locked(async () => {
    if (ids.length === 0) return;
    const lib = await getLibrary();
    for (const id of ids) delete lib[id];
    await setLibrary(lib);
    await AsyncStorage.multiRemove(ids.flatMap((id) => [chaptersKey(id), detailsKey(id), seriesKey(id), similarKey(id)])).catch(() => {});
  });
}

// Comic entries left by app versions before comics were removed are never
// listed; the one-time cleanup (removeComicsData in downloads.js) deletes them.
export async function listBooks() {
  const lib = await getLibrary();
  return Object.values(lib).filter((b) => b && b.type !== "comic");
}

// Books with saved progress, most-recent first (Continue Listening).
/** @param {any[]} books */
function inProgress(books) {
  return books
    .filter((b) => isStarted(b) && !b.progress.finished)
    .sort((a, b) => (b.progress.lastPlayed || 0) - (a.progress.lastPlayed || 0));
}
/** @param {any[]} books */
function downloaded(books) {
  return books
    .filter((b) => b.downloaded && !(b.progress && b.progress.finished))
    .sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0));
}
/** @param {any[]} books */
function finished(books) {
  return books
    .filter((b) => b.progress && b.progress.finished)
    .sort((a, b) => (b.progress.lastPlayed || 0) - (a.progress.lastPlayed || 0));
}
// Saved for later and not started yet (starting one moves it to Continue
// Listening), most recently saved first.
/** @param {any[]} books */
export function wantToListen(books) {
  return books
    .filter((b) => b && b.saved && !isStarted(b))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}
/** @param {any} book */
export function isStarted(book) {
  const p = book.progress || {};
  return !!p.finished || p.position > 5 || p.trackIndex > 0;
}

export async function continueListening() {
  return inProgress(await listBooks());
}

// The Library screen's lists from ONE read of the library (it used to parse
// the whole stored library once per section on every visit).
export async function librarySections() {
  const books = await listBooks();
  return {
    continueListening: inProgress(books), wantToListen: wantToListen(books), downloads: downloaded(books), finished: finished(books),
    bookmarkCount: books.reduce((n, b) => n + (Array.isArray(b.bookmarks) ? b.bookmarks.length : 0), 0),
  };
}

// After wiping the download folder: clear flags/local files but keep listening
// progress, so books stay in Continue Listening and can be re-resolved.
export function clearDownloadFlags() {
  return locked(async () => {
    const lib = await getLibrary();
    for (const id of Object.keys(lib)) {
      if (lib[id].downloaded) {
        delete lib[id].downloaded;
        delete lib[id].downloadedAt;
        delete lib[id].storageDir;
        lib[id].files = [];
      }
    }
    await setLibrary(lib);
  });
}

// Same, but for one book (auto-delete finished, per-book cleanup).
export function clearBookDownload(id) {
  return locked(async () => {
    const lib = await getLibrary();
    if (!lib[id]) return;
    delete lib[id].downloaded;
    delete lib[id].downloadedAt;
    delete lib[id].storageDir;
    lib[id].files = [];
    await setLibrary(lib);
  });
}

// Downloaded but not yet finished (finished ones live in the Finished section).
export async function downloadedBooks() {
  return downloaded(await listBooks());
}

// Books listened to the end, most recent first.
export async function finishedBooks() {
  return finished(await listBooks());
}

// ---- bookmarks ---------------------------------------------------------------
// bm: { position, trackIndex, createdAt, note? }

// Books with bookmarks, the most recently bookmarked first.
export async function bookmarkedBooks() {
  const latest = (b) => Math.max(...b.bookmarks.map((m) => m.createdAt || 0));
  return (await listBooks())
    .filter((b) => Array.isArray(b.bookmarks) && b.bookmarks.length > 0)
    .sort((a, b) => latest(b) - latest(a));
}
export function addBookmark(book, bm) {
  return locked(async () => {
    const lib = await getLibrary();
    const entry = lib[book.id] || { id: book.id, title: book.title, author: book.author, poster: book.poster };
    entry.bookmarks = [...(entry.bookmarks || []), bm].sort(
      (a, b) => a.trackIndex - b.trackIndex || a.position - b.position
    );
    lib[book.id] = entry;
    await setLibrary(lib);
    return entry.bookmarks;
  });
}

// A short note on a bookmark ("great quote", "who is this?"). Empty clears it.
export function setBookmarkNote(id, createdAt, note) {
  return locked(async () => {
    const lib = await getLibrary();
    if (!lib[id]) return [];
    const text = String(note || "").trim().slice(0, 500);
    lib[id].bookmarks = (lib[id].bookmarks || []).map((b) => {
      if (b.createdAt !== createdAt) return b;
      const { note: _old, ...rest } = b;
      return text ? { ...rest, note: text } : rest;
    });
    await setLibrary(lib);
    return lib[id].bookmarks;
  });
}

export function removeBookmark(id, createdAt) {
  return locked(async () => {
    const lib = await getLibrary();
    if (!lib[id]) return [];
    lib[id].bookmarks = (lib[id].bookmarks || []).filter((b) => b.createdAt !== createdAt);
    await setLibrary(lib);
    return lib[id].bookmarks;
  });
}

// Recheck local state inside the existing write queue before applying cloud data.
export function applyAccountBook(id, record, expected, assertCurrent) {
  return locked(async () => {
    if (!isAccountId(id)) throw new Error("Invalid cloud book id.");
    await assertCurrent();
    const lib = await getLibrary();
    const current = Object.prototype.hasOwnProperty.call(lib, id) ? lib[id] : null;
    if (!sameBook(current, expected)) return { applied: false, local: projectBook(current) };
    if (record.deleted) {
      if (!current?.downloaded && !current?.files?.some(file => String(file.uri || file.url || "").startsWith("file:"))) delete lib[id];
    } else {
      const next = { ...(current || { files: [] }) };
      for (const key of ACCOUNT_FIELDS) delete next[key];
      lib[id] = { ...next, ...projectBook(record.book), id };
    }
    await assertCurrent();
    await setLibrary(lib);
    return { applied: true, local: projectBook(lib[id]) };
  });
}
