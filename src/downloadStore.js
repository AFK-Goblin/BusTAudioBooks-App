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
    pct: 0, // whole book, not the current file
    status: "preparing",
    book: meta.book,
    files: meta.files,
    // Per-file sizes from the server, when it reports them (2.2+).
    sizes: (meta.files || []).map((f) => (f && f.size > 0 ? f.size : 0)),
  };
  emit();
}

export function beginTransfer(id) {
  const a = active[id];
  if (!a) return;
  a.status = "downloading";
  emit();
}

function sum(values) {
  return values.reduce((total, v) => total + v, 0);
}

export function reportProgress(id, i, count, written, total) {
  const a = active[id];
  if (!a) return;
  a.status = "downloading";
  a.i = i;
  a.count = count;
  const sizes = a.sizes || [];
  if (sizes.length === count && sizes.every((s) => s > 0)) {
    // Exact: bytes of finished files plus this one's.
    a.bytesTotal = sum(sizes);
    a.bytesDone = Math.min(a.bytesTotal, sum(sizes.slice(0, i)) + (written || 0));
    a.pct = Math.floor((a.bytesDone / a.bytesTotal) * 100);
  } else {
    // Without sizes every file weighs the same.
    const fraction = total ? Math.min(1, (written || 0) / total) : 0;
    a.pct = Math.floor(((i + fraction) / Math.max(1, count)) * 100);
  }
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
