// src/settings.js — persisted user settings (AsyncStorage) with a tiny
// observable store, mirroring the downloadStore pattern. Load once at boot
// via initSettings(); read synchronously afterwards with getSettings().
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

const SKEY = "bustaudio_settings";

export const DEFAULTS = {
  speed: 1, // default playback speed applied when a book loads
  jumpBack: 15, // seconds
  jumpForward: 30, // seconds
  wifiOnly: false, // downloads only on un-metered connections
  autoResume: false, // load last book (paused) on app launch
  autoDeleteFinished: false, // free downloaded files once a book is finished
};

export const SPEED_OPTIONS = [0.8, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const JUMP_BACK_OPTIONS = [10, 15, 30, 60];
export const JUMP_FORWARD_OPTIONS = [15, 30, 45, 60];

let settings = { ...DEFAULTS };
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn({ ...settings }));
}

export async function initSettings() {
  try {
    const s = await AsyncStorage.getItem(SKEY);
    if (s) settings = { ...DEFAULTS, ...JSON.parse(s) };
  } catch (_) {
    /* corrupt/missing — keep defaults */
  }
  emit();
  return settings;
}

export function getSettings() {
  return settings;
}

export async function setSetting(key, value) {
  settings = { ...settings, [key]: value };
  emit();
  try {
    await AsyncStorage.setItem(SKEY, JSON.stringify(settings));
  } catch (_) {}
  return settings;
}

export function subscribeSettings(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// React hook: current settings, re-renders on change.
export function useSettings() {
  const [s, setS] = useState(settings);
  useEffect(() => subscribeSettings(setS), []);
  return s;
}
