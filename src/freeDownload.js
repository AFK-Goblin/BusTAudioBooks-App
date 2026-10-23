// src/freeDownload.js — delete a book's downloaded files but keep the book:
// progress, bookmarks and the library entry stay, so it can be streamed or
// downloaded again from where it was.
import { getCurrentBook, closeBook } from "./player";
import { deleteDownload } from "./downloads";
import { clearBookDownload } from "./library";

export async function freeDownload(id) {
  // Deleting the files of the book that's playing would cut it off.
  const current = getCurrentBook();
  if (current && current.id === id) await closeBook().catch(() => {});
  await deleteDownload(id);
  await clearBookDownload(id);
}
