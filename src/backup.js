// src/backup.js — everything that only lives on this phone (which books, where
// you are in them, bookmarks and notes, per-book speeds, listening stats,
// settings) as one small JSON text you can save anywhere and paste back in,
// e.g. on a new phone. Downloads, stream links and the server link are left
// out: they don't carry over, and books re-resolve when you play them.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLibrary, mergeBackupBooks } from "./library";
import { DEFAULTS, getSettings, setSetting } from "./settings";
import { mergeListening } from "./stats";

export const BACKUP_FORMAT = "bustaudio-backup";
const BACKUP_VERSION = 1;
const PROGRESS_FIELDS = ["position", "trackIndex", "duration", "finished", "lastPlayed", "rate", "trackDurations"];

function pick(source, fields) {
  const out = {};
  for (const field of fields) if (source && source[field] !== undefined) out[field] = source[field];
  return out;
}

export async function buildBackup(now = Date.now()) {
  const lib = await getLibrary();
  const books = Object.values(lib)
    .filter((b) => b && b.id && b.type !== "comic")
    .map((b) => ({
      ...pick(b, ["id", "title", "author", "poster", "format", "saved", "savedAt", "rating"]),
      ...(b.progress ? { progress: pick(b.progress, PROGRESS_FIELDS) } : {}),
      ...(Array.isArray(b.bookmarks) && b.bookmarks.length ? { bookmarks: b.bookmarks } : {}),
    }));
  let listening = {};
  let listeningBooks = {};
  try {
    const raw = await AsyncStorage.getItem("bustaudio_listening");
    const stored = (raw && JSON.parse(raw)) || {};
    listening = stored.days || {};
    listeningBooks = stored.books || {};
  } catch (_) {
    /* no stats yet */
  }
  const settings = pick(getSettings(), Object.keys(DEFAULTS));
  return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now, books, listening, listeningBooks, settings });
}

// Merges a backup into this phone. Returns { added, updated }.
export async function restoreBackup(text) {
  let data;
  try {
    data = JSON.parse(String(text || "").trim());
  } catch (_) {
    throw new Error("That isn't a BusTAudio backup — paste the whole text you saved.");
  }
  if (!data || data.format !== BACKUP_FORMAT || !Array.isArray(data.books)) {
    throw new Error("That isn't a BusTAudio backup — paste the whole text you saved.");
  }
  if (data.version > BACKUP_VERSION) throw new Error("This backup comes from a newer app version. Update the app first.");
  const result = await mergeBackupBooks(data.books.filter((b) => b && typeof b.id === "string" && b.id && typeof b.title === "string"));
  if (data.listening && typeof data.listening === "object") {
    await mergeListening(data.listening, data.listeningBooks && typeof data.listeningBooks === "object" ? data.listeningBooks : {});
  }
  if (data.settings && typeof data.settings === "object") {
    for (const [key, value] of Object.entries(data.settings)) {
      if (key in DEFAULTS && typeof value === typeof DEFAULTS[key]) await setSetting(key, value);
    }
  }
  return result;
}
