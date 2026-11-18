type BookFile = { title?: string; url?: string; uri?: string };
type Book = { id: string; title: string; author?: string; poster?: string; files?: BookFile[] };

export function buildPlayerConfig() {
  return {
    contentType: "speech" as const,
    handleAudioBecomingNoisy: true,
    android: {
      wakeMode: "network" as const,
      taskRemovedBehavior: "continue" as const,
    },
    progressSync: { intervalSeconds: 5 },
    // RNTP preloads whole files for positive windows; audiobook parts can be GBs.
    cache: { maxSizeBytes: 512 * 1024 * 1024, preloading: { window: 0 } },
  };
}

export function buildRemoteCommands(forwardInterval: number, backwardInterval: number) {
  return {
    // Android compact media controls have three primary action slots. Keep
    // those focused on audiobook transport; chapter navigation stays in-app.
    capabilities: ["skipBackward", "playPause", "skipForward", "seek"],
    handling: "native" as const,
    forwardInterval,
    backwardInterval,
  };
}

const AUDIO_FILENAME = /\.(mp3|m4a|m4b|mp4|aac|flac|ogg|oga|opus|wav|wma)$/i;

// What the notification / lock screen shows for one part. Server titles are
// often bare filenames ("Book_Name.m4b"): a single-file book shows the book
// title instead, and multi-part books lose the extension.
export function partTitle(book: Pick<Book, "title">, file: BookFile, index: number, count: number): string {
  const raw = (file.title || "").trim();
  const fallback = `${book.title} — Part ${index + 1}`;
  if (!raw) return fallback;
  if (!AUDIO_FILENAME.test(raw)) return raw;
  if (count === 1) return book.title;
  return raw.replace(AUDIO_FILENAME, "").replace(/_+/g, " ").trim() || fallback;
}

export function buildMediaItems(book: Book) {
  const files = book.files ?? [];
  return files.map((file, index) => ({
    mediaId: `${book.id}:${index}`,
    url: file.uri || file.url || "",
    title: partTitle(book, file, index, files.length),
    artist: book.author || "BusTAudio",
    albumTitle: book.title,
    ...(book.poster ? { artworkUrl: book.poster } : {}),
    extras: { bookId: book.id, trackIndex: index },
  }));
}

export function parseMediaId(mediaId: string) {
  const separator = mediaId.lastIndexOf(":");
  if (separator <= 0) return null;
  const trackIndex = Number(mediaId.slice(separator + 1));
  if (!Number.isInteger(trackIndex) || trackIndex < 0) return null;
  return { bookId: mediaId.slice(0, separator), trackIndex };
}
