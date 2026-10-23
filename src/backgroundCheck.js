// src/backgroundCheck.js — what the app does every half hour or so while it's
// closed (Android schedules it, so timing is approximate):
//   • books waiting on TorBox that are ready now get a notification — the
//     download itself starts when you open the app, since Android doesn't let
//     a background job start one;
//   • once a day, new books in the series you're reading are announced.
import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { initSettings, getSettings } from "./settings";
import { listBooks } from "./library";
import { checkWaiting } from "./waiting";
import { newReleases } from "./releaseAlerts";
import { notify } from "./notify";
import { refreshCarBrowse } from "./player";

export const BACKGROUND_CHECK = "bustaudio-background-check";
const INTERVAL_MINUTES = 30;
const RELEASES_EVERY_MS = 20 * 60 * 60 * 1000;
const RELEASES_AT_KEY = "bustaudio_releases_checked_at";

export async function runBackgroundCheck(now = Date.now()) {
  await initSettings();
  const settings = getSettings();
  await checkWaiting({ startDownloads: false, notifyReady: settings.notifyReady !== false });
  if (settings.notifyReleases !== false) {
    const last = Number(await AsyncStorage.getItem(RELEASES_AT_KEY).catch(() => 0)) || 0;
    if (now - last >= RELEASES_EVERY_MS) {
      await AsyncStorage.setItem(RELEASES_AT_KEY, String(now)).catch(() => {});
      for (const { series, book } of await newReleases(await listBooks(), now)) {
        await notify(`New in ${series}`, `“${book.title}” (book ${book.position}) is out.`, { query: book.search || book.title });
      }
    }
  }
  // Keep the car's list current with the latest progress and downloads.
  await refreshCarBrowse().catch(() => {});
}

// Defined at load (index.js imports this file), so Android can run it with
// only the JS engine started.
TaskManager.defineTask(BACKGROUND_CHECK, async () => {
  try {
    await runBackgroundCheck();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (_) {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundCheck() {
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return false;
    await BackgroundTask.registerTaskAsync(BACKGROUND_CHECK, { minimumInterval: INTERVAL_MINUTES });
    return true;
  } catch (_) {
    return false;
  }
}
