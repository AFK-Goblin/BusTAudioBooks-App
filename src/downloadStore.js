// src/downloadStore.js — global, observable state of in-progress downloads so
// any screen (Home, Library) can show what's downloading, not just the one that
// started it. Failed downloads stay visible until the user retries or dismisses.
import { useEffect, useState } from "react";

let active = {}; // id -> { id, title, poster, i, count, pct, status, error, book, files }
const listeners = new Set();

function emit() {
  const arr = Object.values(active);
  listeners.forEach((fn) => fn(arr));
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(Object.values(active));
  return () => listeners.delete(fn);
}

// meta: { title, poster, count, book, files } — book/files kept so a failed
// download can be retried from any screen.
export function startTracking(id, meta) {
  active[id] = {
    id,
    title: meta.title,
    poster: meta.poster,
    i: 0,
    count: meta.count || 1,
    pct: 0,
    status: "downloading",
    book: meta.book,
    files: meta.files,
  };
  emit();
}

export function reportProgress(id, i, count, written, total) {
  const a = active[id];
  if (!a) return;
  a.i = i;
  a.count = count;
  if (total) a.pct = Math.round((written / total) * 100);
  emit();
}

export function finishTracking(id) {
  delete active[id];
  emit();
}

// Keep the failed entry around (with its book/files) until retried/dismissed.
export function failTracking(id, msg) {
  const a = active[id];
  if (!a) return;
  a.status = "error";
  a.error = msg;
  emit();
}

export function dismissTracking(id) {
  delete active[id];
  emit();
}

// React hook: returns the current list of active downloads.
export function useDownloads() {
  const [items, setItems] = useState([]);
  useEffect(() => subscribe(setItems), []);
  return items;
}
