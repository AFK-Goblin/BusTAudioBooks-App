// src/bookmarks.js — how bookmarks read, on screen and when shared.
import { formatTime } from "./format";

// "1:02:03", or "Part 2 · 1:02:03" in a multi-part book.
export function bookmarkPlace(book, bm) {
  const parts = (book.files || []).length;
  const multiPart = parts > 1 || (bm.trackIndex || 0) > 0;
  return `${multiPart ? `Part ${(bm.trackIndex || 0) + 1} · ` : ""}${formatTime(bm.position || 0)}`;
}

// Plain text for the share sheet: the book, then each bookmark in book order
// with its note.
export function bookmarksText(book) {
  const marks = [...(book.bookmarks || [])].sort(
    (a, b) => (a.trackIndex || 0) - (b.trackIndex || 0) || (a.position || 0) - (b.position || 0),
  );
  const head = book.author ? `${book.title} — ${book.author}` : book.title;
  const lines = marks.map((bm) => `• ${bookmarkPlace(book, bm)}${bm.note ? ` — ${bm.note}` : ""}`);
  return [head, "Bookmarks from BusTAudioBooks", "", ...lines].join("\n");
}
