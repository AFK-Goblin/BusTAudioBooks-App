// src/downloadPrompt.js — start a download only after checking it fits.
// A book that fills the phone halfway through fails late and leaves a partial
// download behind; asking first is cheaper. File sizes come from the server
// (3.0+); without them there is nothing to check and the download just starts.
import { Alert } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { formatBytes } from "./format";
import { startDownload } from "./downloads";

// Room to leave for the phone itself after the download.
export const SPACE_HEADROOM = 200 * 1024 * 1024;

export function totalSize(files) {
  return (files || []).reduce((total, f) => total + (f && f.size > 0 ? f.size : 0), 0);
}

export async function checkSpace(files) {
  const needed = totalSize(files);
  let free = null;
  try {
    free = await FileSystem.getFreeDiskStorageAsync();
  } catch (_) {
    /* unknown: don't block the download on it */
  }
  const enough = !(needed > 0) || free == null || free - needed >= SPACE_HEADROOM;
  return { needed, free, enough };
}

// Resolves true when the download started, false when the user backed out.
export async function downloadWithSpaceCheck(book, files) {
  const { needed, free, enough } = await checkSpace(files);
  if (enough) {
    startDownload(book, files);
    return true;
  }
  return new Promise((resolve) => {
    Alert.alert(
      "Not enough space",
      free < needed
        ? `This book needs ${formatBytes(needed)}, but your phone only has ${formatBytes(free)} free.`
        : `This book needs ${formatBytes(needed)} and would leave less than ${formatBytes(SPACE_HEADROOM)} free on your phone.`,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Download anyway", onPress: () => { startDownload(book, files); resolve(true); } },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
