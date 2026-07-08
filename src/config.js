// src/config.js
// The app is configured by pasting the BusTAudio install link generated on the
// server's /configure page. We store the "prefix" (origin + config blob) and
// build every API call from it — so the TorBox key + access token live inside
// that blob exactly as the Stremio addon expects.
import * as SecureStore from "expo-secure-store";

const KEY = "bustaudio_prefix";

// "https://host/<blob>/manifest.json" -> "https://host/<blob>"
export function parseInstallLink(link) {
  let s = String(link || "").trim();
  s = s.replace(/^stremio:/i, "https:");
  s = s
    .replace(/\/manifest\.json.*$/i, "")
    .replace(/\/configure.*$/i, "")
    .replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+\/[A-Za-z0-9_-]+$/.test(s)) return null;
  return s;
}

export async function savePrefix(prefix) {
  await SecureStore.setItemAsync(KEY, prefix);
}
export async function getPrefix() {
  return SecureStore.getItemAsync(KEY);
}
export async function clearPrefix() {
  await SecureStore.deleteItemAsync(KEY);
}
