// src/waiting.js — "Download when ready": books TorBox is still fetching that
// should download by themselves once it has them. Checked when the app
// starts, when it comes back to the foreground, and every few minutes while
// it's open (Android doesn't give a closed app a chance to check).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { getStreams } from "./api";
import { checkSpace } from "./downloadPrompt";
import { enqueueDownload } from "./downloads";
import { getBook, upsertBook } from "./library";
import { showToast } from "./toast";
import { notify } from "./notify";

const KEY = "bustaudio_waiting";

let items = null; // id -> { id, title, author, poster, format, addedAt, status, checkedAt }
let checking = null;
const listeners = new Set();

async function load() {
  if (items) return items;
  try {
    items = JSON.parse((await AsyncStorage.getItem(KEY)) || "{}") || {};
  } catch (_) {
    items = {};
  }
  return items;
}

function list() {
  return Object.values(items || {}).sort((a, b) => a.addedAt - b.addedAt);
}

async function save() {
  const now = list();
  listeners.forEach((listener) => listener(now));
  await AsyncStorage.setItem(KEY, JSON.stringify(items || {})).catch(() => {});
}

export async function waitFor(item, status = null) {
  await load();
  const { id, title, author, poster, format } = item;
  items[id] = { id, title, author: author || null, poster: poster || null, format: format || null, addedAt: Date.now(), status, checkedAt: Date.now() };
  // In the library meanwhile (without files), so its synopsis can be kept.
  await upsertBook({ id, title, author, poster, format }).catch(() => {});
  await save();
}

export async function stopWaiting(id) {
  await load();
  if (!items[id]) return;
  delete items[id];
  await save();
}

// One pass: start every waiting book TorBox now has ready. Safe to call often.
// In the background (startDownloads: false) a ready book is announced once
// instead — Android doesn't let a background job start a download.
export function checkWaiting({ startDownloads = true, notifyReady = false } = {}) {
  if (checking) return checking;
  checking = (async () => {
    await load();
    for (const w of list()) {
      const entry = await getBook(w.id).catch(() => null);
      if (entry && entry.downloaded) {
        delete items[w.id];
        continue;
      }
      let result = null;
      try {
        result = await getStreams(w.id);
      } catch (e) {
        w.status = e.message || "Couldn't check";
      }
      w.checkedAt = Date.now();
      const streams = (result && result.ready && result.streams) || [];
      if (streams.length === 0) {
        if (result) w.status = result.status || "Waiting on TorBox";
        continue;
      }
      const files = streams.map((s) => ({ title: s.title, url: s.url, filename: s.filename, ...(s.size > 0 ? { size: s.size } : {}) }));
      if (!startDownloads) {
        w.status = "Ready on TorBox — open the app to start the download.";
        if (notifyReady && !w.announced) {
          w.announced = true;
          await notify("Ready to download", `“${w.title}” is ready on TorBox. Open BusTAudioBooks to download it.`, { screen: "library" });
        }
        continue;
      }
      if (!(await checkSpace(files)).enough) {
        w.status = "Ready, but your phone is short on space — open the book to download anyway.";
        continue;
      }
      try {
        await enqueueDownload({ id: w.id, title: w.title, author: w.author, poster: w.poster, format: w.format, files }, files);
        delete items[w.id];
        showToast(`“${w.title}” is ready on TorBox — download queued`);
      } catch (err) {
        w.status = err.message || "Couldn't start the download. Will try again.";
      }
    }
    await save();
  })().finally(() => { checking = null; });
  return checking;
}

export function useWaiting() {
  const [now, setNow] = useState(() => list());
  useEffect(() => {
    let alive = true;
    load().then(() => { if (alive) setNow(list()); });
    listeners.add(setNow);
    return () => { alive = false; listeners.delete(setNow); };
  }, []);
  return now;
}
