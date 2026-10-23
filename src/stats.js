// src/stats.js — how much you listen: seconds per local day, and per book.
//
// Counted from the playback session wherever it runs (app or background
// service): each update adds how far the book moved, divided by the speed, as
// long as that agrees with the wall clock. Seeks and part changes therefore
// never count as listening, while a stretch where JS was paused but audio kept
// playing still does.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

const KEY = "bustaudio_listening";
const MAX_DAYS = 400;
const FLUSH_MS = 30_000;
const STREAK_MIN_SECONDS = 60;

export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Noon of the local day `offset` days before nowMs. Calendar arithmetic, not
// "minus 24 hours", so days stay distinct across daylight-saving changes.
function dayBefore(nowMs, offset) {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset, 12).getTime();
}

let pending = {}; // day -> seconds not yet written
let pendingBooks = {}; // book id -> seconds not yet written
let writing = Promise.resolve();
const listeners = new Set();

// Stored as { days: { "2026-10-23": seconds }, books: { [bookId]: seconds } }.
async function readStored() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const map = (value) => (value && typeof value === "object" ? value : {});
    return { days: map(parsed && parsed.days), books: map(parsed && parsed.books) };
  } catch (_) {
    return { days: {}, books: {} };
  }
}

function update(change) {
  writing = writing
    .then(async () => {
      const stored = await readStored();
      change(stored);
      const keys = Object.keys(stored.days).sort();
      while (keys.length > MAX_DAYS) delete stored.days[keys.shift()];
      await AsyncStorage.setItem(KEY, JSON.stringify(stored));
      listeners.forEach((listener) => listener());
    })
    .catch(() => {});
  return writing;
}

export function flushListening() {
  const add = pending;
  const addBooks = pendingBooks;
  pending = {};
  pendingBooks = {};
  if (Object.keys(add).length === 0 && Object.keys(addBooks).length === 0) return writing;
  return update(({ days, books }) => {
    for (const [day, seconds] of Object.entries(add)) days[day] = (days[day] || 0) + seconds;
    for (const [id, seconds] of Object.entries(addBooks)) books[id] = (books[id] || 0) + seconds;
  });
}

// Restoring a backup: per day (and per book), keep the larger of the two
// totals, so restoring the same backup twice never double-counts.
export async function mergeListening(incoming, incomingBooks) {
  await flushListening();
  const valid = (seconds) => Number.isFinite(seconds) && seconds > 0;
  return update(({ days, books }) => {
    for (const [day, seconds] of Object.entries(incoming || {})) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && valid(seconds)) days[day] = Math.max(days[day] || 0, seconds);
    }
    for (const [id, seconds] of Object.entries(incomingBooks || {})) {
      if (id && valid(seconds)) books[id] = Math.max(books[id] || 0, seconds);
    }
  });
}

// Everything stored, plus what hasn't been written yet.
async function readAll() {
  const { days, books } = await readStored();
  for (const [d, s] of Object.entries(pending)) days[d] = (days[d] || 0) + s;
  for (const [id, s] of Object.entries(pendingBooks)) books[id] = (books[id] || 0) + s;
  return { days, books };
}

// Seconds you've spent listening to one book (since 3.1).
export async function listenedTo(id) {
  return (await readAll()).books[id] || 0;
}

// Feed it session snapshots (see playback/runtime.ts).
/** @param {{ subscribe: (listener: (snapshot: any) => void) => () => void, now?: () => number }} deps */
export function followListening({ subscribe, now = Date.now }) {
  let last; // { t, position, track, bookId } while playing
  let lastFlush = now();
  return subscribe((snapshot) => {
    const t = now();
    const book = snapshot.book;
    // Measured against the previous update even if this one is the pause, so
    // the last seconds before pausing still count.
    if (last && book && last.bookId === book.id && last.track === snapshot.activeTrackIndex) {
      const wall = (t - last.t) / 1000;
      const listened = (snapshot.positionSeconds - last.position) / (snapshot.rate || 1);
      if (wall > 0 && listened > 0 && Math.abs(wall - listened) <= 5 + wall * 0.2) {
        const day = dayKey(t);
        pending[day] = (pending[day] || 0) + listened;
        pendingBooks[book.id] = (pendingBooks[book.id] || 0) + listened;
      }
    }
    const playing = snapshot.intent === "playing" && snapshot.status === "playing";
    last = playing && book ? { t, position: snapshot.positionSeconds, track: snapshot.activeTrackIndex, bookId: book.id } : undefined;
    if (!playing || t - lastFlush >= FLUSH_MS) {
      lastFlush = t;
      void flushListening();
    }
  });
}

// The last `count` days, oldest first: [{ key, seconds, time }] (time = noon
// of that day, for labels).
export function dailySeries(days, count, nowMs = Date.now()) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const time = dayBefore(nowMs, i);
    const key = dayKey(time);
    out.push({ key, seconds: days[key] || 0, time });
  }
  return out;
}

// The longest run of consecutive days with at least a minute of listening.
export function bestStreak(days) {
  const active = Object.keys(days).filter((k) => days[k] >= STREAK_MIN_SECONDS).sort();
  let best = 0;
  let run = 0;
  let previous = null;
  for (const key of active) {
    const [y, m, d] = key.split("-").map(Number);
    run = previous === dayKey(new Date(y, m - 1, d - 1, 12).getTime()) ? run + 1 : 1;
    best = Math.max(best, run);
    previous = key;
  }
  return best;
}

// { today, week (last 7 days), month (last 30), total, streak (days in a row
// with ≥ 1 min), best (longest streak ever), activeDays }.
export function summarize(days, nowMs = Date.now()) {
  const day = (offset) => days[dayKey(dayBefore(nowMs, offset))] || 0;
  const today = day(0);
  let week = 0;
  let month = 0;
  for (let i = 0; i < 30; i++) {
    if (i < 7) week += day(i);
    month += day(i);
  }
  const total = Object.values(days).reduce((sum, s) => sum + s, 0);
  // A streak survives until today ends: if nothing yet today, count from yesterday.
  let streak = 0;
  for (let i = today >= STREAK_MIN_SECONDS ? 0 : 1; day(i) >= STREAK_MIN_SECONDS; i++) streak++;
  const activeDays = Object.values(days).filter((s) => s >= STREAK_MIN_SECONDS).length;
  return { today, week, month, total, streak, best: bestStreak(days), activeDays };
}

// { days, books } including what hasn't been written yet; null while loading.
export function useListening() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => readAll().then((value) => { if (alive) setData(value); });
    load();
    listeners.add(load);
    return () => { alive = false; listeners.delete(load); };
  }, []);
  return data;
}

export function useListeningDays() {
  const data = useListening();
  return data ? data.days : null;
}

export function useListeningStats() {
  const days = useListeningDays();
  return days ? summarize(days) : null;
}
