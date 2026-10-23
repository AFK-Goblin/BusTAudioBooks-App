// Embedded chapters for one part of a book, read once and remembered on the
// library entry. Streamed parts are read over HTTP Range, downloaded ones
// from disk; MP4-family files (.m4b/.m4a/.mp4) and MP3s with ID3v2 CHAP
// frames are both understood.
import { getEmbeddedChapters, saveEmbeddedChapters } from "../library";
import { readId3Chapters, startsWithId3 } from "./id3";
import { CachedReader, readMp4Chapters, type ByteSource, type Chapter } from "./mp4";
import { localSource, remoteSource } from "./sources";

// Bump when the parser learns a new layout, so files remembered as having no
// chapters are read again. 2: ID3v2 CHAP (MP3).
export const CHAPTER_PARSER_VERSION = 2;

type PartFile = { title?: string; filename?: string; url?: string; uri?: string };
type Book = { id: string; files: PartFile[] };
type Stored = { v: number; chapters: Chapter[] | null };

// Formats whose chapter markers (if any) we can't read. Anything else is
// probed — one small read tells MP4 from ID3 from neither.
const UNSUPPORTED = /\.(flac|ogg|oga|opus|wav|wma|aac|aiff?|ape|alac)$/i;

// Picks the parser from the file's first bytes (served from the same cached
// block the parser reads next, so sniffing costs no extra request).
export async function readEmbeddedChapters(reader: CachedReader): Promise<Chapter[] | null> {
  const head = await reader.read(0, 10);
  return startsWithId3(head) ? readId3Chapters(reader) : readMp4Chapters(reader);
}

export function chapterKey(file: PartFile, index: number): string {
  return `${index}:${file.filename || file.title || ""}`;
}

export function mightHaveEmbeddedChapters(file: PartFile): boolean {
  const name = (file.filename || file.uri || file.title || "").split("?")[0] ?? "";
  return !UNSUPPORTED.test(name);
}

type Dependencies = {
  stored(id: string): Promise<Record<string, Stored>>;
  save(id: string, key: string, value: Stored): Promise<void>;
  openLocal(uri: string): Promise<ByteSource>;
  openRemote(url: string): ByteSource;
};

const defaults: Dependencies = {
  stored: getEmbeddedChapters, save: saveEmbeddedChapters, openLocal: localSource, openRemote: (url) => remoteSource(url),
};

export function createChapterService(deps: Dependencies = defaults) {
  const inFlight = new Map<string, Promise<Chapter[] | null>>();
  // Unreadable this session (offline, expired link): try again next launch.
  const failed = new Set<string>();

  return async function embeddedChapters(book: Book, index: number): Promise<Chapter[] | null> {
    const file = book.files[index];
    if (!file) return null;
    const key = chapterKey(file, index);
    const stored = (await deps.stored(book.id).catch(() => ({} as Record<string, Stored>)))[key];
    if (stored && stored.v === CHAPTER_PARSER_VERSION) return stored.chapters;
    if (!mightHaveEmbeddedChapters(file)) return null;
    const memo = `${book.id}|${key}`;
    if (failed.has(memo)) return null;
    let job = inFlight.get(memo);
    if (!job) {
      job = (async () => {
        const source = file.uri ? await deps.openLocal(file.uri) : file.url ? deps.openRemote(file.url) : null;
        if (!source) return null;
        const chapters = await readEmbeddedChapters(new CachedReader(source));
        await deps.save(book.id, key, { v: CHAPTER_PARSER_VERSION, chapters });
        return chapters;
      })()
        .catch(() => {
          failed.add(memo);
          return null;
        })
        .finally(() => inFlight.delete(memo));
      inFlight.set(memo, job);
    }
    return job;
  };
}

export const embeddedChapters = createChapterService();
