// src/notify.js — local notifications: "Dune is ready on TorBox", "a new
// Dungeon Crawler Carl book is out". Nothing is pushed from a server — the
// app's own background check (src/backgroundCheck.js) posts them.
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const CHANNEL = "book-updates";
let channel = null;

function ensureChannel() {
  if (Platform.OS !== "android") return Promise.resolve();
  channel = channel || Notifications.setNotificationChannelAsync(CHANNEL, {
    name: "Book updates", importance: Notifications.AndroidImportance.DEFAULT,
  }).catch(() => {});
  return channel;
}

// ask: show Android's "Allow notifications?" prompt if it may still be shown.
export async function notificationsAllowed(ask = false) {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted || !ask || current.canAskAgain === false) return !!current.granted;
    return !!(await Notifications.requestPermissionsAsync()).granted;
  } catch (_) {
    return false;
  }
}

// data says where tapping it goes: { screen: "library" } or { query: "…" }.
export async function notify(title, body, data = {}) {
  try {
    if (!(await notificationsAllowed())) return false;
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data },
      trigger: Platform.OS === "android" ? { channelId: CHANNEL } : null,
    });
    return true;
  } catch (_) {
    return false;
  }
}
