// src/api.js — talks to the BusTAudio backend's /app endpoints.
import { getPrefix } from "./config";

async function req(path, { timeout = 20000, prefixOverride } = {}) {
  const prefix = prefixOverride || (await getPrefix());
  if (!prefix) throw new Error("Not configured");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    let res;
    try {
      res = await fetch(prefix + path, { signal: ctrl.signal });
    } catch (e) {
      // fetch itself failed: no answer at all. Say so in words people can act
      // on, instead of "Network request failed" / "Aborted".
      if (e && e.name === "AbortError") throw new Error("Your server took too long to answer. Try again in a moment.");
      throw new Error("Can't reach your BusTAudio server. Check your connection — downloaded books still play from the Library.");
    }
    if (res.status === 403) throw new Error("The server rejected this link's access token — ask whoever runs it for a new install link.");
    if (!res.ok) {
      // The server explains failures in the body ({ error } or { status }),
      // e.g. "Search is unavailable right now — AudiobookBay: … Cloudflare …".
      let message = null;
      try {
        const body = await res.json();
        message = [body && body.error, body && body.err, body && body.status].find((m) => typeof m === "string" && m);
      } catch (_) {
        /* not JSON */
      }
      throw new Error(message || `Server error (HTTP ${res.status})`);
    }
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

// Synopsis / genre / year for the book page (server 3.0+; older servers 404).
export async function getDetails(id) {
  return req(`/app/details/${encodeURIComponent(id)}`, { timeout: 12000 });
}

// The book's series and what comes next (server 3.1+; older servers 404).
export async function getSeries(id) {
  const j = await req(`/app/series/${encodeURIComponent(id)}`, { timeout: 15000 });
  return (j && j.series) || null;
}

// "Because you listened to…" suggestions (server 3.2+; older servers 404).
export async function getSimilar(id) {
  const j = await req(`/app/similar/${encodeURIComponent(id)}`, { timeout: 15000 });
  return (j && j.similar) || null;
}

export async function appVersion() {
  return req(`/app/version`, { timeout: 10000 });
}
