import { CachedReader, decodeTitle, parseChpl, readMp4Chapters, type ByteSource } from "../mp4";

// ---- tiny MP4 writer ----------------------------------------------------------
function bytes(...parts: (Uint8Array | number[])[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be64 = (n: number) => [...be32(Math.floor(n / 0x1_0000_0000)), ...be32(n >>> 0)];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const utf8 = (s: string) => [...new TextEncoder().encode(s)];
function box(type: string, ...payload: (Uint8Array | number[])[]): Uint8Array {
  const body = bytes(...payload);
  return bytes(be32(body.length + 8), ascii(type), body);
}
const full = (version = 0) => [version, 0, 0, 0];

const tkhd = (id: number) => box("tkhd", full(), be32(0), be32(0), be32(id), be32(0), be32(0));
const mdhd = (timescale: number) => box("mdhd", full(), be32(0), be32(0), be32(timescale), be32(0), be32(0));
const hdlr = (handler: string) => box("hdlr", full(), be32(0), ascii(handler), be32(0), be32(0), be32(0), [0]);
const titleSample = (title: string) => bytes(be16(utf8(title).length), utf8(title));

type TextTrack = { id: number; timescale: number; durations: number[]; chunks: { offset: number; samples: number }[]; sizes: number[]; wideOffsets?: boolean };
function textTrak(t: TextTrack): Uint8Array {
  const stts = box("stts", full(), be32(t.durations.length), ...t.durations.map((d) => [...be32(1), ...be32(d)]));
  const stsz = box("stsz", full(), be32(0), be32(t.sizes.length), ...t.sizes.map(be32));
  const stsc = box("stsc", full(), be32(t.chunks.length), ...t.chunks.map((c, i) => [...be32(i + 1), ...be32(c.samples), ...be32(1)]));
  const stco = t.wideOffsets
    ? box("co64", full(), be32(t.chunks.length), ...t.chunks.map((c) => be64(c.offset)))
    : box("stco", full(), be32(t.chunks.length), ...t.chunks.map((c) => be32(c.offset)));
  const stbl = box("stbl", box("stsd", full(), be32(0)), stts, stsz, stsc, stco);
  return box("trak", tkhd(t.id), box("mdia", mdhd(t.timescale), hdlr("text"), box("minf", box("gmhd"), stbl)));
}
// The audio track's sample tables are what make real moov boxes huge; a big
// stsz here proves the walker skips it instead of reading it.
const audioTrak = (chapterTrackId?: number) => box("trak",
  tkhd(1),
  box("mdia", mdhd(44100), hdlr("soun"), box("minf", box("smhd", full(), be32(0)), box("stbl", box("stsz", full(), be32(0), be32(200_000), new Uint8Array(800_000))))),
  ...(chapterTrackId ? [box("tref", box("chap", be32(chapterTrackId)))] : []),
);
const ftyp = box("ftyp", ascii("M4A "), be32(0), ascii("isom"));

// A file made of placed segments over a large zero-filled span, so a 300 MB
// mdat costs nothing to "store". Counts reads like a network source would.
function sparseFile(size: number, segments: [number, Uint8Array][]) {
  const reads: [number, number][] = [];
  const source: ByteSource = {
    size: () => size,
    async read(offset, length) {
      reads.push([offset, length]);
      const end = Math.min(size, offset + length);
      const out = new Uint8Array(Math.max(0, end - offset));
      for (const [start, data] of segments) {
        const from = Math.max(start, offset);
        const to = Math.min(start + data.length, end);
        if (to > from) out.set(data.subarray(from - start, to - start), from - offset);
      }
      return out;
    },
  };
  return { source, reads };
}

function moovAtEndFile(options: { wide?: boolean; titles?: string[] } = {}) {
  const titles = options.titles ?? ["Opening Credits", "Chapter 1: The Beginning", "Chapitre 2 — Été"];
  const mdatSize = options.wide ? 5 * 1024 ** 3 : 300 * 1024 * 1024;
  const mdatHeader = options.wide ? bytes(be32(1), ascii("mdat"), be64(mdatSize)) : bytes(be32(mdatSize), ascii("mdat"));
  const mdatStart = ftyp.length;
  // Titles sit inside the audio data at their chapters' positions.
  const samples = titles.map(titleSample);
  const placements = samples.map((_, i) => mdatStart + 1_000_000 + i * 90_000_000);
  const moov = box("moov",
    box("mvhd", full(), new Uint8Array(96)),
    audioTrak(2),
    textTrak({
      id: 2, timescale: 1000, durations: [65_000, 3_600_000, 1_000], sizes: samples.map((s) => s.length),
      chunks: placements.map((offset) => ({ offset, samples: 1 })), wideOffsets: options.wide ?? false,
    }),
  );
  const moovStart = mdatStart + mdatSize;
  const size = moovStart + moov.length;
  return sparseFile(size, [[0, ftyp], [mdatStart, mdatHeader], ...placements.map((p, i) => [p, samples[i]!] as [number, Uint8Array]), [moovStart, moov]]);
}

test("reads a QuickTime chapter track whose moov sits after 300 MB of audio", async () => {
  const file = moovAtEndFile();
  const reader = new CachedReader(file.source);
  expect(await readMp4Chapters(reader)).toEqual([
    { start: 0, title: "Opening Credits" },
    { start: 65, title: "Chapter 1: The Beginning" },
    { start: 3665, title: "Chapitre 2 — Été" },
  ]);
  // Headers + the small text-track tables + one read per title — never the
  // 800 KB audio sample table and never the audio itself.
  const fetched = file.reads.reduce((sum, [, length]) => sum + length, 0);
  expect(reader.reads).toBeLessThanOrEqual(8);
  expect(fetched).toBeLessThan(1024 * 1024);
});

test("handles 64-bit box sizes and co64 offsets beyond 4 GB", async () => {
  const file = moovAtEndFile({ wide: true });
  const chapters = await readMp4Chapters(new CachedReader(file.source));
  expect(chapters?.map((c) => c.title)).toEqual(["Opening Credits", "Chapter 1: The Beginning", "Chapitre 2 — Été"]);
});

test("several title samples in one chunk are located through stsc", async () => {
  const samples = ["One", "Two", "Three"].map(titleSample);
  const chunk = bytes(...samples);
  const moov = box("moov", audioTrak(5), textTrak({
    id: 5, timescale: 10, durations: [10, 20, 30], sizes: samples.map((s) => s.length), chunks: [{ offset: 4096, samples: 3 }],
  }));
  const size = 8192 + moov.length;
  const file = sparseFile(size, [[0, ftyp], [ftyp.length, bytes(be32(8192 - ftyp.length), ascii("free"))], [4096, chunk], [8192, moov]]);
  expect(await readMp4Chapters(new CachedReader(file.source))).toEqual([
    { start: 0, title: "One" }, { start: 1, title: "Two" }, { start: 3, title: "Three" },
  ]);
});

test("falls back to Nero chpl chapters in moov/udta", async () => {
  const entry = (seconds: number, title: string) => [...be64(seconds * 10_000_000), utf8(title).length, ...utf8(title)];
  const chpl = box("chpl", [1, 0, 0, 0], be32(0), [3], entry(0, "Intro"), entry(125.5, "Part One"), entry(4000, "Part Two"));
  const moov = box("moov", audioTrak(), box("udta", chpl));
  const file = sparseFile(ftyp.length + moov.length, [[0, ftyp], [ftyp.length, moov]]);
  expect(await readMp4Chapters(new CachedReader(file.source))).toEqual([
    { start: 0, title: "Intro" }, { start: 125.5, title: "Part One" }, { start: 4000, title: "Part Two" },
  ]);
});

test("a raw ADTS file named .mp4 is rejected after one read", async () => {
  const adts = new Uint8Array(4096).fill(0xff);
  adts[1] = 0xf1;
  const file = sparseFile(50 * 1024 * 1024, [[0, adts]]);
  const reader = new CachedReader(file.source);
  expect(await readMp4Chapters(reader)).toBeNull();
  expect(reader.reads).toBe(1);
});

test("an MP4 without chapter markers reports none", async () => {
  const moov = box("moov", audioTrak());
  const file = sparseFile(ftyp.length + moov.length, [[0, ftyp], [ftyp.length, moov]]);
  expect(await readMp4Chapters(new CachedReader(file.source))).toBeNull();
});

test("an unreadable title fails the parse instead of returning a shortened list", async () => {
  const file = moovAtEndFile();
  const titleOffsets = new Set([ftyp.length + 1_000_000 + 90_000_000]);
  const flaky: ByteSource = {
    size: () => file.source.size(),
    async read(offset, length) {
      const hitsTitle = [...titleOffsets].some((t) => t >= offset && t < offset + length);
      return hitsTitle ? new Uint8Array(0) : file.source.read(offset, length);
    },
  };
  await expect(readMp4Chapters(new CachedReader(flaky))).rejects.toThrow();
});

test("a failed read inside the index is an error, never 'no chapters'", async () => {
  const file = moovAtEndFile();
  const moovStart = ftyp.length + 300 * 1024 * 1024;
  // The server answers but drops the body for the block holding the moov.
  const flaky: ByteSource = {
    size: () => file.source.size(),
    async read(offset, length) {
      return offset <= moovStart && moovStart < offset + length ? new Uint8Array(10) : file.source.read(offset, length);
    },
  };
  await expect(readMp4Chapters(new CachedReader(flaky))).rejects.toThrow("short read");
});

test("a title read that fails once is retried", async () => {
  const file = moovAtEndFile();
  let failures = 1;
  const flaky: ByteSource = {
    size: () => file.source.size(),
    async read(offset, length) {
      const title = ftyp.length + 1_000_000 + 90_000_000;
      if (failures > 0 && title >= offset && title < offset + length) { failures--; throw new Error("reset by peer"); }
      return file.source.read(offset, length);
    },
  };
  expect(await readMp4Chapters(new CachedReader(flaky))).toHaveLength(3);
});

test("decodes UTF-16 titles with a byte-order mark, and parses chpl version 0", () => {
  expect(decodeTitle(new Uint8Array([0xfe, 0xff, 0x00, 0x48, 0x00, 0x69]))).toBe("Hi");
  expect(decodeTitle(new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]))).toBe("Hi");
  const v0 = bytes([0, 0, 0, 0], [1], be64(0), [1], ascii("A"));
  expect(parseChpl(v0)).toEqual([{ start: 0, title: "A" }]);
});

test("the block cache serves repeated reads without refetching", async () => {
  const data = new Uint8Array(200_000).map((_, i) => i % 251);
  const file = sparseFile(data.length, [[0, data]]);
  const reader = new CachedReader(file.source, 65_536);
  const a = await reader.read(10, 100);
  const b = await reader.read(60_000, 10_000); // spans blocks 0 and 1
  expect(Array.from(a.subarray(0, 3))).toEqual([10, 11, 12]);
  expect(b[0]).toBe(60_000 % 251);
  expect(b[9_999]).toBe(69_999 % 251);
  expect(file.reads).toEqual([[0, 65_536], [65_536, 65_536]]);
  expect(Array.from(await reader.read(199_990, 50))).toHaveLength(10);
});
