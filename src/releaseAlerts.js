// src/releaseAlerts.js — "A Parade of Horribles (Dungeon Crawler Carl #8) is
// out": books in the series you're reading released since the last check,
// that you don't have yet. Each is announced once.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { seriesOf, ownedCopy } from "./series";

const KEY = "bustaudio_release_alerts"; // { since: "YYYY-MM-DD", told: [keys] }
const TOLD_MAX = 300;
const SERIES_MAX = 10;

function dayString(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function started(book) {
  const p = (book && book.progress) || {};
  return !!p.finished || p.position > 5 || p.trackIndex > 0;
}

// [{ series, book }] newly out. The first call only starts the clock, so
// books that came out before alerts existed aren't announced.
export async function newReleases(books, now = Date.now()) {
  const today = dayString(now);
  let state = null;
  try {
    state = JSON.parse((await AsyncStorage.getItem(KEY)) || "null");
  } catch (_) {
    state = null;
  }
  if (!state || !state.since) {
    await AsyncStorage.setItem(KEY, JSON.stringify({ since: today, told: [] })).catch(() => {});
    return [];
  }
  const told = new Set(state.told || []);
  const seen = new Set();
  const out = [];
  const reading = books.filter(started)
    .sort((a, b) => ((b.progress && b.progress.lastPlayed) || 0) - ((a.progress && a.progress.lastPlayed) || 0))
    .slice(0, SERIES_MAX);
  for (const book of reading) {
    const series = await seriesOf(book.id);
    if (!series || seen.has(series.name)) continue;
    seen.add(series.name);
    for (const b of series.books) {
      const key = `${series.name}#${b.position}`;
      if (!b.released || b.released <= state.since || b.released > today || told.has(key) || ownedCopy(b, books)) continue;
      told.add(key);
      out.push({ series: series.name, book: b });
    }
  }
  await AsyncStorage.setItem(KEY, JSON.stringify({ since: today, told: [...told].slice(-TOLD_MAX) })).catch(() => {});
  return out;
}
