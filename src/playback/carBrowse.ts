// What Android Auto shows: your downloaded books, as folders of their parts.
// Only downloads — they play with no connection and without this app running,
// which streamed links (they expire) can't promise. Selecting a part plays the
// whole book from there; the session then resumes it at the saved place (see
// PlaybackSession.adoptForeignQueue). The tree is kept natively, so the car
// can list it while the app is closed.
import { buildMediaItems } from "./config";

type Progress = { position?: number; trackIndex?: number; finished?: boolean; lastPlayed?: number };
type LibraryBook = {
  id: string; title: string; author?: string; poster?: string; downloaded?: boolean; downloadedAt?: number;
  files?: { uri?: string; url?: string; title?: string; filename?: string }[]; progress?: Progress;
};

const CONTINUE_MAX = 20;
const DOWNLOADED_MAX = 50;

function playableOffline(book: LibraryBook): boolean {
  return !!book.downloaded && Array.isArray(book.files) && book.files.length > 0 && book.files.every((f) => !!f.uri);
}
function inProgress(book: LibraryBook): boolean {
  const p = book.progress || {};
  return !p.finished && ((p.position || 0) > 5 || (p.trackIndex || 0) > 0);
}

function bookFolder(book: LibraryBook) {
  const current = inProgress(book) ? book.progress?.trackIndex || 0 : -1;
  const parts = buildMediaItems(book as any);
  return {
    mediaId: `book:${book.id}`,
    title: book.title,
    ...(book.author ? { artist: book.author } : {}),
    ...(book.poster ? { artworkUrl: book.poster } : {}),
    children: parts.map((part, i) => ({
      mediaId: part.mediaId,
      title: i === current ? `▶ Resume · ${part.title}` : part.title,
      ...(book.author ? { artist: book.author } : {}),
      ...(book.poster ? { artworkUrl: book.poster } : {}),
      url: part.url,
      extras: part.extras,
    })),
  };
}

export function buildBrowseTree(books: LibraryBook[]) {
  const offline = books.filter((b) => b && playableOffline(b) && !(b.progress && b.progress.finished));
  const continuing = offline.filter(inProgress)
    .sort((a, b) => (b.progress?.lastPlayed || 0) - (a.progress?.lastPlayed || 0))
    .slice(0, CONTINUE_MAX);
  const rest = offline.filter((b) => !inProgress(b))
    .sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0))
    .slice(0, DOWNLOADED_MAX);
  return [
    ...(continuing.length ? [{ mediaId: "cat:continue", title: "Continue listening", items: continuing.map(bookFolder) }] : []),
    { mediaId: "cat:downloaded", title: "Downloaded", items: rest.map(bookFolder) },
  ];
}
