// src/api.js — talks to the BusTAudio backend's /app endpoints.
import { getPrefix } from "./config";

async function req(path, { timeout = 20000, prefixOverride } = {}) {
  const prefix = prefixOverride || (await getPrefix());
  if (!prefix) throw new Error("Not configured");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(prefix + path, { signal: ctrl.signal });
    if (res.status === 403) throw new Error("Access token rejected by server");
    if (!res.ok) throw new Error(`Server error (HTTP ${res.status})`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function search(query, page = 1, type = "audiobook", source) {
  // Only append params beyond the defaults so URLs to older servers stay unchanged.
  const t = type === "comic" ? "&type=comic" : "";
  const s = type === "comic" && source === "series" ? "&source=series" : "";
  const j = await req(`/app/search?q=${encodeURIComponent(query)}&page=${page}${t}${s}`);
  return (j && j.results) || [];
}

export async function getStreams(id) {
  return req(`/app/streams/${encodeURIComponent(id)}`, { timeout: 45000 });
}

// MangaDex series: chapter list (server-side filtered/deduped, sliced).
export async function getChapters(id, offset = 0, limit = 100) {
  return req(`/app/chapters/${encodeURIComponent(id)}?offset=${offset}&limit=${limit}`, { timeout: 30000 });
}

// MangaDex chapter: page image URLs. fresh=1 bypasses the server cache —
// used when a page URL has expired mid-read.
export async function getPages(chapterId, { saver, fresh } = {}) {
  const q = [saver && "saver=1", fresh && "fresh=1"].filter(Boolean).join("&");
  return req(`/app/pages/${encodeURIComponent(chapterId)}${q ? `?${q}` : ""}`, { timeout: 30000 });
}

// Pass a prefix to validate a server before saving it (SetupScreen).
export async function health(prefixOverride) {
  return req(`/health`, { timeout: 10000, prefixOverride });
}

export async function appVersion() {
  return req(`/app/version`, { timeout: 10000 });
}
