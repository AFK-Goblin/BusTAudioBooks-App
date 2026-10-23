// src/series.js — "Next in series". The server (3.1+) finds the book's series
// in Audible's catalogue; for books in your library the answer is remembered
// for a few days, so Home can suggest what's next without asking every visit.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSeries, getSimilar } from "./api";
import { getBook, seriesKey, similarKey } from "./library";

const FRESH_MS = 3 * 24 * 60 * 60 * 1000;
const MISS_MS = 12 * 60 * 60 * 1000; // "no series" is asked again sooner

// Asks the server, remembering the answer for books in your library.
async function remembered(key, id, ask) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const { at, value, series } = JSON.parse(raw);
      const stored = value !== undefined ? value : series; // 3.1 stored "series"
      if (Date.now() - at < (stored ? FRESH_MS : MISS_MS)) return stored;
    }
  } catch (_) {
    /* ask the server */
  }
  let value;
  try {
    value = await ask(id);
  } catch (_) {
    return null; // offline, or an older server: nothing remembered
  }
  if (await getBook(id).catch(() => null)) {
    AsyncStorage.setItem(key, JSON.stringify({ at: Date.now(), value })).catch(() => {});
  }
  return value;
}

// { name, position, total, books: [{ title, search, position, poster, released, upcoming, current }], next } or null.
export function seriesOf(id) {
  return remembered(seriesKey(id), id, getSeries);
}

// { because, books: [{ title, search, author, poster, released, upcoming, series, kind }] } or null (server 3.2+).
export function similarTo(id) {
  return remembered(similarKey(id), id, getSimilar);
}

const STOPWORDS = new Set(["the", "a", "an", "of", "and", "book", "unabridged"]);
function words(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOPWORDS.has(w));
}

// The library entry that is this series book, if you have it: nearly all of
// its title's words appear in the entry's (torrent) title.
export function ownedCopy(seriesBook, books) {
  const want = words(seriesBook.title);
  if (want.length === 0) return null;
  return books.find((entry) => {
    const have = new Set(words(entry.title));
    return want.filter((w) => have.has(w)).length / want.length >= 0.8;
  }) || null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-05-12" → "Coming 12 May" (with the year when it isn't this year).
export function comingLabel(released, now = new Date()) {
  const [y, m, d] = String(released || "").split("-").map(Number);
  if (!y || !m || !d) return "Coming soon";
  return `Coming ${d} ${MONTHS[m - 1]}${y !== now.getFullYear() ? ` ${y}` : ""}`;
}

// Home's "Continue the series": for the books you finished most recently, the
// next book in each series — unless you've already started it.
export async function continueSeries(books, limit = 6) {
  const finished = books
    .filter((b) => b && b.progress && b.progress.finished)
    .sort((a, b) => (b.progress.lastPlayed || 0) - (a.progress.lastPlayed || 0))
    .slice(0, limit);
  const furthest = new Map(); // series name -> the furthest book you finished in it
  for (const book of finished) {
    const series = await seriesOf(book.id);
    if (!series || !series.next || series.next.upcoming) continue;
    const at = parseFloat(series.position);
    const known = furthest.get(series.name);
    if (!known || at > known.at) furthest.set(series.name, { at, series });
  }
  const out = [];
  for (const { series } of furthest.values()) {
    const owned = ownedCopy(series.next, books);
    const p = (owned && owned.progress) || {};
    if (owned && (p.finished || p.position > 5 || p.trackIndex > 0)) continue;
    out.push({ series: series.name, book: series.next, owned });
  }
  return out;
}

// Series labels for many books from what's already remembered (no network):
// id -> { name, position }.
export async function rememberedSeries(ids) {
  const out = {};
  try {
    const pairs = await AsyncStorage.multiGet(ids.map(seriesKey));
    pairs.forEach(([, raw], i) => {
      try {
        const stored = raw && JSON.parse(raw);
        const series = stored && (stored.value !== undefined ? stored.value : stored.series);
        if (series) out[ids[i]] = { name: series.name, position: series.position };
      } catch (_) {
        /* skip it */
      }
    });
  } catch (_) {
    /* no labels */
  }
  return out;
}

// Ask about a few books nothing has looked up yet (once per app session each),
// so the Library's series labels fill in over time. Returns how many it asked.
const asked = new Set();
export async function fillSeries(ids, limit = 4) {
  let pairs = [];
  try {
    pairs = await AsyncStorage.multiGet(ids.map(seriesKey));
  } catch (_) {
    return 0;
  }
  const unknown = ids.filter((id, i) => !(pairs[i] && pairs[i][1]) && !asked.has(id)).slice(0, limit);
  for (const id of unknown) {
    asked.add(id);
    await seriesOf(id);
  }
  return unknown.length;
}

function started(book) {
  const p = (book && book.progress) || {};
  return !!p.finished || p.position > 5 || p.trackIndex > 0;
}
const byLastPlayed = (a, b) => ((b.progress && b.progress.lastPlayed) || 0) - ((a.progress && a.progress.lastPlayed) || 0);

// Home's "Because you listened to…": suggestions from the most recent book you
// started or finished that has some you don't own yet.
export async function becauseYouListened(books, tries = 3) {
  const recent = books.filter(started).sort(byLastPlayed).slice(0, tries);
  for (const book of recent) {
    const similar = await similarTo(book.id);
    if (!similar) continue;
    const fresh = similar.books.filter((b) => !b.upcoming && !ownedCopy(b, books));
    if (fresh.length) return { because: similar.because || book.title, books: fresh };
  }
  return null;
}

const NEW_DAYS = 45;
function dayString(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Home's "New in your series": books in the series you're reading that came
// out in the last few weeks or aren't out yet, and that you don't have.
// [{ series, book: { …, upcoming } }], just released first, then soonest out.
export async function seriesNews(books, now = Date.now(), limit = 8) {
  const today = dayString(now);
  const since = dayString(now - NEW_DAYS * 86_400_000);
  const seen = new Set();
  const out = [];
  for (const book of books.filter(started).sort(byLastPlayed).slice(0, limit)) {
    const series = await seriesOf(book.id);
    if (!series || seen.has(series.name)) continue;
    seen.add(series.name);
    for (const b of series.books) {
      if (!b.released || b.released < since || ownedCopy(b, books)) continue;
      out.push({ series: series.name, book: { ...b, upcoming: b.released > today } });
    }
  }
  return out.sort((a, b) => (a.book.upcoming - b.book.upcoming)
    || (a.book.upcoming ? a.book.released.localeCompare(b.book.released) : b.book.released.localeCompare(a.book.released)));
}
