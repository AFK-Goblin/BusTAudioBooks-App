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
    cache: { maxSizeBytes: 512 * 1024 * 1024, preloading: { window: 1 } },
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

export function buildMediaItems(book: Book) {
  return (book.files ?? []).map((file, index) => ({
    mediaId: `${book.id}:${index}`,
    url: file.uri || file.url || "",
    title: file.title || `${book.title} — Part ${index + 1}`,
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
