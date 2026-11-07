// The personal API receives metadata only. Local paths, streams and credentials
// never cross this boundary, including unexpected nested fields.
export const ACCOUNT_FIELDS = ['id', 'title', 'author', 'poster', 'format', 'saved', 'savedAt', 'rating', 'progress', 'bookmarks'];
export function projectBook(book) {
  if (!book) return null;
  const out = {};
  for (const key of ['id', 'title', 'author', 'poster', 'format']) if (typeof book[key] === 'string') out[key] = book[key];
  for (const key of ['savedAt', 'rating']) if (Number.isFinite(book[key])) out[key] = book[key];
  if (typeof book.saved === 'boolean') out.saved = book.saved;
  if (book.progress && typeof book.progress === 'object') {
    out.progress = {};
    for (const key of ['position', 'duration', 'trackIndex', 'lastPlayed', 'rate']) if (Number.isFinite(book.progress[key])) out.progress[key] = book.progress[key];
    if (typeof book.progress.finished === 'boolean') out.progress.finished = book.progress.finished;
    if (Array.isArray(book.progress.trackDurations)) out.progress.trackDurations = book.progress.trackDurations.map(n => Number.isFinite(n) ? n : null);
  }
  if (Array.isArray(book.bookmarks)) out.bookmarks = book.bookmarks.map(mark => {
    const safe = {};
    for (const key of ['createdAt', 'position', 'trackIndex']) if (Number.isFinite(mark?.[key])) safe[key] = mark[key];
    if (typeof mark?.note === 'string') safe.note = mark.note;
    return safe;
  });
  return out;
}
export function sameBook(a, b) { return JSON.stringify(projectBook(a)) === JSON.stringify(projectBook(b)); }

export function isAccountId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 8192 && !['__proto__', 'constructor', 'prototype'].includes(id) && !/[\x00-\x1f\x7f]/.test(id);
}
