import { readEmbeddedChapters } from "../index";
import { decodeId3Text, readId3Chapters } from "../id3";
import { CachedReader, type ByteSource } from "../mp4";

jest.mock("expo-file-system/legacy", () => ({}));
jest.mock("../../library", () => ({}));

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const utf8 = (s: string) => [...new TextEncoder().encode(s)];

function frame(id: string, body: number[], version: number, flags = [0, 0]) {
  return [...ascii(id), ...(version >= 4 ? syncsafe(body.length) : be32(body.length)), ...flags, ...body];
}
const tit2 = (title: string, version: number, encoding = 3) => {
  const text = encoding === 1 ? [0xff, 0xfe, ...[...title].flatMap((c) => [c.charCodeAt(0), 0])] : encoding === 0 ? ascii(title) : utf8(title);
  return frame("TIT2", [encoding, ...text], version);
};
const chap = (id: string, startMs: number, endMs: number, title: string | null, version: number, encoding?: number) =>
  frame("CHAP", [...ascii(id), 0, ...be32(startMs), ...be32(endMs), ...be32(0xffffffff), ...be32(0xffffffff), ...(title ? tit2(title, version, encoding) : [])], version);

function tag(version: number, frames: number[][], options: { padding?: number; extended?: boolean } = {}) {
  const ext = options.extended ? (version >= 4 ? [...syncsafe(6), 1, 0] : [...be32(6), 0, 0, 0, 0, 0, 0]) : [];
  const body = [...ext, ...frames.flat(), ...new Array(options.padding ?? 0).fill(0)];
  return new Uint8Array([...ascii("ID3"), version, 0, options.extended ? 0x40 : 0, ...syncsafe(body.length), ...body]);
}

function source(data: Uint8Array, audioBytes = 10_000_000) {
  const reads: [number, number][] = [];
  const size = data.length + audioBytes;
  const src: ByteSource = {
    size: () => size,
    async read(offset, length) {
      reads.push([offset, length]);
      const out = new Uint8Array(Math.max(0, Math.min(length, size - offset)));
      out.set(data.subarray(offset, offset + out.length).subarray(0, Math.max(0, Math.min(out.length, data.length - offset))));
      return out;
    },
  };
  return { src, reads };
}

test("reads ID3v2.3 CHAP frames, out of order, and sorts them", async () => {
  const data = tag(3, [
    frame("TALB", [3, ...utf8("Book")], 3),
    chap("ch1", 600_000, 1_200_000, "Two", 3),
    chap("ch0", 0, 600_000, "One", 3),
    chap("ch2", 1_200_000, 1_800_000, "Trois — été", 3),
  ], { padding: 500 });
  expect(await readId3Chapters(new CachedReader(source(data).src))).toEqual([
    { start: 0, title: "One" }, { start: 600, title: "Two" }, { start: 1200, title: "Trois — été" },
  ]);
});

test("reads ID3v2.4 syncsafe sizes, UTF-16 titles and untitled chapters", async () => {
  const data = tag(4, [chap("a", 0, 1000, "Intro", 4, 1), chap("b", 90_500, 2000, null, 4)], { extended: true });
  expect(await readId3Chapters(new CachedReader(source(data).src))).toEqual([
    { start: 0, title: "Intro" }, { start: 90.5, title: "Chapter 2" },
  ]);
});

test("skips a large cover picture without fetching it", async () => {
  const picture = frame("APIC", [0, ...ascii("image/jpeg"), 0, 3, 0, ...new Array(3_000_000).fill(7)], 3);
  const data = tag(3, [picture, chap("a", 0, 1, "A", 3), chap("b", 5000, 1, "B", 3)]);
  const { src, reads } = source(data);
  const reader = new CachedReader(src);
  expect(await readId3Chapters(reader)).toHaveLength(2);
  const fetched = reads.reduce((sum, [, length]) => sum + length, 0);
  expect(fetched).toBeLessThan(300_000); // not the 3 MB picture
});

test("an MP3 with an ID3 tag but no chapters reports none; the dispatcher picks ID3", async () => {
  const plain = tag(3, [frame("TIT2", [3, ...utf8("Just a title")], 3)]);
  expect(await readEmbeddedChapters(new CachedReader(source(plain).src))).toBeNull();
  const chaptered = tag(3, [chap("a", 0, 1, "A", 3), chap("b", 1000, 2, "B", 3)]);
  expect(await readEmbeddedChapters(new CachedReader(source(chaptered).src))).toHaveLength(2);
});

test("decodes every ID3 text encoding", () => {
  expect(decodeId3Text(new Uint8Array([0, 0x43, 0x61, 0x66, 0xe9, 0]))).toBe("Café");
  expect(decodeId3Text(new Uint8Array([1, 0xff, 0xfe, 0x48, 0, 0x69, 0, 0, 0]))).toBe("Hi");
  expect(decodeId3Text(new Uint8Array([2, 0, 0x48, 0, 0x69]))).toBe("Hi");
  expect(decodeId3Text(new Uint8Array([3, ...utf8("Été")]))).toBe("Été");
});
