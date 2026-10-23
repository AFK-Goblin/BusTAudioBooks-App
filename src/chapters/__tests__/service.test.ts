import { chapterKey, createChapterService, CHAPTER_PARSER_VERSION, mightHaveEmbeddedChapters } from "../index";
import type { ByteSource } from "../mp4";
import { chapterEnd, chapterIndexAt, nextChapterTarget, previousChapterTarget } from "../navigation";
import { decodeBase64, remoteSource } from "../sources";

jest.mock("expo-file-system/legacy", () => ({}));
jest.mock("../../library", () => ({}));

// ---- a minimal chpl-only M4B ---------------------------------------------------
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, ...body: number[][]) => {
  const flat = body.flat();
  return [...be32(flat.length + 8), ...ascii(type), ...flat];
};
const entry = (seconds: number, title: string) => [...be32(0), ...be32(seconds * 10_000_000), title.length, ...ascii(title)];
const m4b = new Uint8Array([
  ...box("ftyp", ascii("M4B "), be32(0)),
  ...box("moov", box("udta", box("chpl", [1, 0, 0, 0], be32(0), [2], entry(0, "One"), entry(60, "Two")))),
]);
const memorySource = (data: Uint8Array): ByteSource => ({ size: () => data.length, read: async (o, n) => data.slice(o, o + n) });

function service(overrides: Partial<Parameters<typeof createChapterService>[0]> = {}) {
  const store: Record<string, any> = {};
  const deps = {
    stored: jest.fn(async (id: string) => store[id] ?? {}),
    save: jest.fn(async (id: string, key: string, value: any) => {
      store[id] = { ...(store[id] ?? {}), [key]: value };
    }),
    openLocal: jest.fn(async () => memorySource(m4b)),
    openRemote: jest.fn(() => memorySource(m4b)),
    ...overrides,
  };
  return { chapters: createChapterService(deps), deps, store };
}

test("reads a part once, then answers from the library entry", async () => {
  const s = service();
  const book = { id: "b", files: [{ filename: "Book.m4b", uri: "file:///book.m4b" }] };
  const expected = [{ start: 0, title: "One" }, { start: 60, title: "Two" }];
  expect(await s.chapters(book, 0)).toEqual(expected);
  expect(await s.chapters(book, 0)).toEqual(expected);
  expect(s.deps.openLocal).toHaveBeenCalledTimes(1);
  expect(s.store.b[chapterKey(book.files[0]!, 0)]).toEqual({ v: CHAPTER_PARSER_VERSION, chapters: expected });
});

test("streams are read through the remote source; formats without readable markers are never probed", async () => {
  const s = service();
  expect(await s.chapters({ id: "b", files: [{ filename: "x.m4b", url: "https://cdn/x" }] }, 0)).toHaveLength(2);
  expect(s.deps.openRemote).toHaveBeenCalledWith("https://cdn/x");
  expect(await s.chapters({ id: "c", files: [{ filename: "01.flac", url: "https://cdn/y" }] }, 0)).toBeNull();
  expect(s.deps.openRemote).toHaveBeenCalledTimes(1);
  expect(mightHaveEmbeddedChapters({ uri: "file:///a/Part_1.flac" })).toBe(false);
  expect(mightHaveEmbeddedChapters({ uri: "file:///a/Part_1.mp3" })).toBe(true);
  expect(mightHaveEmbeddedChapters({ url: "https://torbox/dl?id=1" })).toBe(true);
});

test("a failed read is not remembered as 'no chapters' and is not retried this session", async () => {
  const s = service({ openRemote: jest.fn(() => ({ size: () => undefined, read: async () => { throw new Error("offline"); } })) });
  const book = { id: "b", files: [{ filename: "x.m4b", url: "https://cdn/x" }] };
  expect(await s.chapters(book, 0)).toBeNull();
  expect(await s.chapters(book, 0)).toBeNull();
  expect(s.deps.save).not.toHaveBeenCalled();
  expect(s.deps.openRemote).toHaveBeenCalledTimes(1);
});

test("navigation targets follow music-player conventions", () => {
  const chapters = [{ start: 0, title: "A" }, { start: 100, title: "B" }, { start: 250, title: "C" }];
  expect(chapterIndexAt(chapters, 99.8)).toBe(1); // within the start tolerance
  expect(chapterIndexAt(chapters, 50)).toBe(0);
  expect(previousChapterTarget(chapters, 150)).toBe(100); // restart current
  expect(previousChapterTarget(chapters, 101)).toBe(0); // just started: go back one
  expect(previousChapterTarget(chapters, 1)).toBeNull(); // first chapter: previous part
  expect(nextChapterTarget(chapters, 150)).toBe(250);
  expect(nextChapterTarget(chapters, 260)).toBeNull(); // last chapter: next part
  expect(chapterEnd(chapters, 1, 400)).toBe(250);
  expect(chapterEnd(chapters, 2, 400)).toBe(400);
});

test("remote reads send a Range header, learn the size, and refuse a full-body 200", async () => {
  const fetcher = jest.fn(async (_url: string, init: any) => ({
    status: init.headers.Range === "bytes=0-3" ? 206 : 200,
    headers: { get: () => "bytes 0-3/1000" },
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  }));
  const source = remoteSource("https://cdn/x", fetcher as unknown as typeof fetch);
  expect(Array.from(await source.read(0, 4))).toEqual([1, 2, 3, 4]);
  expect(source.size()).toBe(1000);
  await expect(source.read(4, 4)).rejects.toThrow("HTTP 200");
});

test("base64 decoding matches Node's", () => {
  const data = Array.from({ length: 257 }, (_, i) => (i * 37) % 256);
  const encoded = btoa(String.fromCharCode(...data));
  expect(Array.from(decodeBase64(encoded))).toEqual(data);
});
