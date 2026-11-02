// src/settings.js — persisted user settings (AsyncStorage) with a tiny
// observable store, mirroring the downloadStore pattern. Load once at boot
// via initSettings(); read synchronously afterwards with getSettings().
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

const SKEY = "bustaudio_settings";
const V2KEY = "bustaudio_settings_v2";

export const DEFAULTS = {
  speed: 1, // default playback speed applied when a book loads
  jumpBack: 15, // seconds
  jumpForward: 30, // seconds
  wifiOnly: false, // downloads only on un-metered connections
  autoResume: false, // load last book (paused) on app launch
  autoDeleteFinished: false, // free downloaded files once a book is finished
  smartRewind: true, // step back a few seconds when resuming after a pause
  sleepFade: true, // sleep timers fade out over their last 30 seconds
  bedtimeTimer: false, // listening started late at night arms a sleep timer
  bedtimeStart: 22, // hour the bedtime window opens (it closes at 06:00)
  bedtimeMinutes: 30, // length of that automatic timer
  instantOnly: false, // search results: only torrents TorBox has cached
  showRemaining: false, // player: right-hand time shows time left, not length
  librarySort: "recent", // "recent" | "title" | "author"
  chapterDisplay: "below", // "below" | "menu": where the player lists chapters and parts
  scrubScope: "chapter", // player slider with embedded chapters: "chapter" | "book"
  dailyGoal: 0, // minutes of listening a day to aim for; 0 = no goal
  libraryCollapsed: [], // Library sections folded away: "continue" | "saved" | "download" | "finished"
  libraryView: "list", // "list" | "grid" (covers, three across)
  notifyReady: true, // notify when a book you're waiting on is ready on TorBox
  notifyReleases: true, // notify when a new book in a series you're reading comes out
};

export const SPEED_OPTIONS = [0.8, 1, 1.1, 1.25, 1.5, 1.75, 2];
// The player's speed sheet: presets plus a 0.05 stepper within these bounds.
export const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 3.5;
export const SLEEP_FADE_SECONDS = 30;
export const BEDTIME_START_OPTIONS = [20, 21, 22, 23, 0];
export const BEDTIME_MINUTE_OPTIONS = [15, 30, 45, 60];
export const JUMP_BACK_OPTIONS = [10, 15, 30, 60];
export const JUMP_FORWARD_OPTIONS = [15, 30, 45, 60];
export const DAILY_GOAL_OPTIONS = [0, 15, 30, 45, 60, 90];

let settings = { ...DEFAULTS };
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn({ ...settings }));
}

export async function initSettings() {
  try {
    const s = (await AsyncStorage.getItem(V2KEY)) || (await AsyncStorage.getItem(SKEY));
    if (s) {
      // Settings of the removed comics feature are dropped, not re-saved.
      const { comicsEnabled: _comics, dataSaver: _saver, ...stored } = JSON.parse(s);
      settings = { ...DEFAULTS, ...stored };
    }
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
    await AsyncStorage.setItem(V2KEY, JSON.stringify({ ...settings, schemaVersion: 2 }));
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
