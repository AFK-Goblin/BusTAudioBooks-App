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

export async function search(query, page = 1) {
  const j = await req(`/app/search?q=${encodeURIComponent(query)}&page=${page}`);
  return (j && j.results) || [];
}

export async function getStreams(id) {
  return req(`/app/streams/${encodeURIComponent(id)}`, { timeout: 45000 });
}

// Pass a prefix to validate a server before saving it (SetupScreen).
export async function health(prefixOverride) {
  return req(`/health`, { timeout: 10000, prefixOverride });
}

export async function appVersion() {
  return req(`/app/version`, { timeout: 10000 });
}
