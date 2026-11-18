import * as FileSystem from "expo-file-system/legacy";
import { getBook, getLibrary, clearBookDownload } from "../library";

// Android can restore database flags without restoring large audio files.
// Filesystem failures propagate: an unreadable disk is not proof of deletion.
async function verifyEntry(entry) {
  if (!entry?.downloaded) return entry;
  let valid = Array.isArray(entry.files) && entry.files.length > 0;
  for (const file of valid ? entry.files : []) {
    if (!file || typeof file.uri !== "string" || !file.uri.startsWith("file://")) { valid = false; break; }
    const info = await FileSystem.getInfoAsync(file.uri, { size: true });
    if (!info.exists || info.isDirectory || !(info.size > 0) || (file.size > 0 && info.size !== file.size)) {
      valid = false; break;
    }
  }
  return valid ? entry : clearBookDownload(entry.id, entry);
}

export async function getVerifiedBook(id) {
  return verifyEntry(await getBook(id));
}

export async function reconcileDownloadedBooks() {
  const library = await getLibrary();
  // Serial inspection avoids opening hundreds of files concurrently.
  for (const entry of Object.values(library)) await verifyEntry(entry);
}
