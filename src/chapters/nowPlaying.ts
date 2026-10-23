// Keeps the now-playing title (notification, lock screen, Bluetooth and car
// displays) on the current embedded chapter. Runs wherever the playback
// session runs, including the background service.
import type { PlaybackBook, PlaybackSnapshot } from "../playback/types";
import type { Chapter } from "./mp4";
import { chapterIndexAt } from "./navigation";

type Dependencies = {
  subscribe(listener: (snapshot: PlaybackSnapshot) => void): () => void;
  chaptersFor(book: PlaybackBook, index: number): Promise<Chapter[] | null>;
  updateMetadata(index: number, metadata: { title?: string; artist?: string; albumTitle?: string }): Promise<void>;
};

export function followChapterTitles(deps: Dependencies): () => void {
  const known = new Map<string, Chapter[] | null>();
  const loading = new Set<string>();
  let shown: string | undefined;
  let lastBook: PlaybackBook | null = null;
  let latest: PlaybackSnapshot | undefined;

  const update = (snapshot: PlaybackSnapshot) => {
    latest = snapshot;
    const book = snapshot.book;
    // A rebuilt queue (new book, restore, stream refresh, retry) carries the
    // original titles again, so the chapter title must be re-applied.
    if (book !== lastBook || snapshot.status === "loading" || snapshot.status === "reconnecting") shown = undefined;
    lastBook = book;
    if (!book || snapshot.status === "loading" || snapshot.status === "reconnecting") return;
    const index = snapshot.activeTrackIndex;
    const part = `${book.id}:${index}`;
    if (!known.has(part)) {
      if (!loading.has(part)) {
        loading.add(part);
        deps.chaptersFor(book, index)
          .then((chapters) => { known.set(part, chapters); })
          .catch(() => { known.set(part, null); })
          .finally(() => {
            loading.delete(part);
            if (latest) update(latest);
          });
      }
      return;
    }
    const chapters = known.get(part);
    if (!chapters || chapters.length === 0) return;
    const chapterIndex = chapterIndexAt(chapters, snapshot.positionSeconds);
    const key = `${part}:${chapterIndex}`;
    if (key === shown) return;
    shown = key;
    deps.updateMetadata(index, {
      title: chapters[chapterIndex]!.title,
      albumTitle: book.title,
      ...(book.author ? { artist: book.author } : {}),
    }).catch(() => { shown = undefined; });
  };

  return deps.subscribe(update);
}
