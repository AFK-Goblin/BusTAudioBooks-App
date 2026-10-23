// Embedded chapter markers in MP4-family audiobooks (.m4b / .m4a / .mp4).
//
// Two layouts exist in the wild and both are read:
//   • QuickTime chapter track — a text track referenced from the audio track's
//     tref/chap box; one text sample per chapter, timed by its stts table.
//     iTunes, Audible conversions and ffmpeg's ipod/m4b muxer write this.
//   • Nero "chpl" — a flat list in moov/udta (start in 100 ns units + title).
//
// Everything goes through a ByteSource so the same code reads a local file or a
// remote URL with HTTP Range requests. Long books have a moov index of several
// megabytes (mostly the audio track's sample tables), often stored after the
// audio data, so the walker only reads box headers plus the small boxes it
// needs, through a block cache: a 380 MB book costs a handful of small reads.
//
// Self-contained on purpose (no React Native imports) so it can run in Node.

export type Chapter = { title: string; start: number };

export interface ByteSource {
  // Total length when known up front (local files); remote sources learn it
  // from their first response and report it via size().
  size(): number | undefined;
  read(offset: number, length: number): Promise<Uint8Array>;
}

const MAX_TOP_LEVEL_BOXES = 64;
const MAX_CHILD_BOXES = 512;
const MAX_CHAPTERS = 5000;
const MAX_TABLE_BYTES = 4 * 1024 * 1024;
const TITLE_READ_CONCURRENCY = 6;

// ---- block-cached reader ----------------------------------------------------

export class CachedReader {
  private readonly blocks = new Map<number, Uint8Array>();
  reads = 0;

  constructor(private readonly source: ByteSource, private readonly blockSize = 64 * 1024, private readonly maxBlocks = 96) {}

  size(): number | undefined { return this.source.size(); }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (length <= 0) return new Uint8Array(0);
    const total = this.size();
    const end = total === undefined ? offset + length : Math.min(offset + length, total);
    if (end <= offset) return new Uint8Array(0);
    const first = Math.floor(offset / this.blockSize);
    const last = Math.floor((end - 1) / this.blockSize);
    // Fetch each run of missing blocks with one request.
    let runStart: number | undefined;
    for (let block = first; block <= last + 1; block++) {
      const missing = block <= last && !this.blocks.has(block);
      if (missing && runStart === undefined) runStart = block;
      if (!missing && runStart !== undefined) {
        await this.fetchRun(runStart, block - 1);
        runStart = undefined;
      }
    }
    const out = new Uint8Array(end - offset);
    for (let block = first; block <= last; block++) {
      const data = this.blocks.get(block);
      if (!data) return out.subarray(0, Math.max(0, block * this.blockSize - offset));
      const blockStart = block * this.blockSize;
      const from = Math.max(offset, blockStart) - blockStart;
      const to = Math.min(end, blockStart + data.length) - blockStart;
      if (to > from) out.set(data.subarray(from, to), blockStart + from - offset);
      if (data.length < this.blockSize && blockStart + data.length < end) {
        return out.subarray(0, blockStart + data.length - offset);
      }
    }
    return out;
  }

  private async fetchRun(firstBlock: number, lastBlock: number): Promise<void> {
    const start = firstBlock * this.blockSize;
    const length = (lastBlock - firstBlock + 1) * this.blockSize;
    this.reads++;
    const data = await this.source.read(start, length);
    const total = this.size();
    // Fewer bytes than the file holds means the read failed part-way. That
    // must surface as an error: read as "end of data" it would turn a network
    // hiccup into a remembered "this book has no chapters".
    const expected = total === undefined ? 1 : Math.max(0, Math.min(length, total - start));
    if (data.length < expected) throw new Error(`short read at ${start}: ${data.length} of ${expected} bytes`);
    for (let block = firstBlock; block <= lastBlock; block++) {
      const from = (block - firstBlock) * this.blockSize;
      if (from >= data.length) break;
      this.blocks.set(block, data.subarray(from, Math.min(data.length, from + this.blockSize)));
    }
    while (this.blocks.size > this.maxBlocks) {
      const oldest = this.blocks.keys().next().value;
      if (oldest === undefined) break;
      this.blocks.delete(oldest);
    }
  }
}

// ---- box primitives -----------------------------------------------------------

type Box = { type: string; start: number; headerSize: number; size: number };
type Reader = { read(offset: number, length: number): Promise<Uint8Array>; size(): number | undefined };

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
}
function u64(bytes: Uint8Array, at: number): number {
  return u32(bytes, at) * 0x1_0000_0000 + u32(bytes, at + 4);
}
function u16(bytes: Uint8Array, at: number): number {
  return (bytes[at]! << 8) | bytes[at + 1]!;
}
function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
}
function plausibleType(type: string): boolean {
  return /^[\x20-\x7e]{4}$/.test(type) || type === "\xa9chp";
}

async function readBoxHeader(reader: Reader, offset: number, limit: number): Promise<Box | null> {
  if (limit - offset < 8) return null;
  const head = await reader.read(offset, Math.min(16, limit - offset));
  if (head.length < 8) return null;
  let size = u32(head, 0);
  const type = fourcc(head, 4);
  if (!plausibleType(type)) return null;
  let headerSize = 8;
  if (size === 1) {
    if (head.length < 16) return null;
    size = u64(head, 8);
    headerSize = 16;
  } else if (size === 0) {
    size = limit - offset; // extends to the end of its parent / the file
  }
  if (size < headerSize || offset + size > limit) return null;
  return { type, start: offset, headerSize, size };
}

async function children(reader: Reader, parent: Box, skip = 0): Promise<Box[]> {
  const out: Box[] = [];
  const limit = parent.start + parent.size;
  let offset = parent.start + parent.headerSize + skip;
  while (offset < limit && out.length < MAX_CHILD_BOXES) {
    const box = await readBoxHeader(reader, offset, limit);
    if (!box) break;
    out.push(box);
    offset += box.size;
  }
  return out;
}

async function body(reader: Reader, box: Box): Promise<Uint8Array> {
  const length = box.size - box.headerSize;
  if (length > MAX_TABLE_BYTES) throw new Error(`${box.type} too large`);
  const data = await reader.read(box.start + box.headerSize, length);
  if (data.length < length) throw new Error(`${box.type} truncated`);
  return data;
}

function find(boxes: Box[], type: string): Box | undefined {
  return boxes.find((box) => box.type === type);
}

// ---- text ----------------------------------------------------------------------

// Hand-rolled so it doesn't depend on TextDecoder support in the JS engine.
function decodeUtf8(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const lead = bytes[i]!;
    const extra = lead < 0x80 ? 0 : lead >= 0xc0 && lead < 0xe0 ? 1 : lead >= 0xe0 && lead < 0xf0 ? 2 : lead >= 0xf0 && lead < 0xf8 ? 3 : -1;
    let code = extra > 0 ? lead & (0x3f >> extra) : lead;
    let valid = extra >= 0;
    for (let k = 1; valid && k <= extra; k++) {
      const next = bytes[i + k];
      if (next === undefined || (next & 0xc0) !== 0x80) valid = false;
      else code = (code << 6) | (next & 0x3f);
    }
    if (!valid) {
      out += "�";
      i++;
      continue;
    }
    out += String.fromCodePoint(code);
    i += extra + 1;
  }
  return out;
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode(littleEndian ? bytes[i]! | (bytes[i + 1]! << 8) : (bytes[i]! << 8) | bytes[i + 1]!);
  }
  return out;
}

export function decodeTitle(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16(bytes.subarray(2), false);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return decodeUtf16(bytes.subarray(2), true);
  return decodeUtf8(bytes);
}

function cleanTitle(title: string, index: number): string {
  const trimmed = title.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  return trimmed || `Chapter ${index + 1}`;
}

// ---- Nero chpl -------------------------------------------------------------------

export function parseChpl(data: Uint8Array): Chapter[] {
  if (data.length < 5) return [];
  const version = data[0]!;
  let at = 4 + (version > 0 ? 4 : 0);
  const count = data[at]!;
  at += 1;
  const chapters: Chapter[] = [];
  for (let i = 0; i < count && at + 9 <= data.length; i++) {
    const start = u64(data, at) / 10_000_000;
    const length = data[at + 8]!;
    at += 9;
    if (at + length > data.length) break;
    chapters.push({ start, title: cleanTitle(decodeTitle(data.subarray(at, at + length)), i) });
    at += length;
  }
  return chapters;
}

// ---- QuickTime chapter track --------------------------------------------------------

type Track = { box: Box; id?: number; chapterRefs: number[]; handler?: string; mdia?: Box };

async function describeTrack(reader: Reader, trak: Box): Promise<Track> {
  const kids = await children(reader, trak);
  const track: Track = { box: trak, chapterRefs: [] };
  const tkhd = find(kids, "tkhd");
  if (tkhd) {
    const data = await reader.read(tkhd.start + tkhd.headerSize, 24);
    if (data.length >= 24) track.id = data[0] === 1 ? u32(data, 20) : u32(data, 12);
  }
  const tref = find(kids, "tref");
  if (tref) {
    for (const ref of await children(reader, tref)) {
      if (ref.type !== "chap") continue;
      const ids = await body(reader, ref);
      for (let at = 0; at + 4 <= ids.length; at += 4) track.chapterRefs.push(u32(ids, at));
    }
  }
  const mdia = find(kids, "mdia");
  if (mdia) {
    track.mdia = mdia;
    const hdlr = find(await children(reader, mdia), "hdlr");
    if (hdlr) {
      const data = await reader.read(hdlr.start + hdlr.headerSize, 12);
      if (data.length >= 12) track.handler = fourcc(data, 8);
    }
  }
  return track;
}

async function readChapterTrack(reader: Reader, track: Track): Promise<Chapter[]> {
  if (!track.mdia) return [];
  const mdiaKids = await children(reader, track.mdia);
  const mdhd = find(mdiaKids, "mdhd");
  const minf = find(mdiaKids, "minf");
  if (!mdhd || !minf) return [];
  const mdhdData = await body(reader, mdhd);
  const timescale = mdhdData[0] === 1 ? u32(mdhdData, 20) : u32(mdhdData, 12);
  if (!timescale) return [];
  const stbl = find(await children(reader, minf), "stbl");
  if (!stbl) return [];
  const tables = await children(reader, stbl);
  const stts = find(tables, "stts");
  const stsz = find(tables, "stsz");
  const stsc = find(tables, "stsc");
  const stco = find(tables, "stco") ?? find(tables, "co64");
  if (!stts || !stsz || !stsc || !stco) return [];

  // Sample start times (stts: runs of [count, delta]).
  const sttsData = await body(reader, stts);
  const starts: number[] = [];
  let clock = 0;
  for (let i = 0, at = 8; i < u32(sttsData, 4) && at + 8 <= sttsData.length; i++, at += 8) {
    const count = u32(sttsData, at);
    const delta = u32(sttsData, at + 4);
    for (let k = 0; k < count && starts.length < MAX_CHAPTERS; k++) {
      starts.push(clock / timescale);
      clock += delta;
    }
  }

  // Sample sizes.
  const stszData = await body(reader, stsz);
  const uniformSize = u32(stszData, 4);
  const sampleCount = Math.min(u32(stszData, 8), MAX_CHAPTERS);
  const sizes = Array.from({ length: sampleCount }, (_, i) => (uniformSize || u32(stszData, 12 + i * 4)));

  // Chunk offsets and the sample→chunk map give each sample's file offset.
  const chunkData = await body(reader, stco);
  const wide = stco.type === "co64";
  const chunkCount = u32(chunkData, 4);
  const chunkOffsets = Array.from({ length: chunkCount }, (_, i) => (wide ? u64(chunkData, 8 + i * 8) : u32(chunkData, 8 + i * 4)));
  const stscData = await body(reader, stsc);
  const runs = Array.from({ length: u32(stscData, 4) }, (_, i) => ({
    firstChunk: u32(stscData, 8 + i * 12), samplesPerChunk: u32(stscData, 12 + i * 12),
  }));
  const offsets: number[] = [];
  let sample = 0;
  for (let chunk = 1; chunk <= chunkCount && sample < sampleCount; chunk++) {
    const run = [...runs].reverse().find((r) => r.firstChunk <= chunk);
    if (!run) break;
    let at = chunkOffsets[chunk - 1]!;
    for (let k = 0; k < run.samplesPerChunk && sample < sampleCount; k++, sample++) {
      offsets.push(at);
      at += sizes[sample]!;
    }
  }

  // Muxers interleave each title sample with the audio at its chapter's
  // position, so titles are spread across the file: one read each, in parallel.
  // A title that can't be read fails the whole parse (one retry first): the
  // caller caches results, and a silently shortened list would stick forever.
  const chapters: (Chapter | null)[] = new Array(offsets.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < offsets.length) {
      const i = next++;
      const size = sizes[i]!;
      if (size < 2 || size > 64 * 1024) continue;
      let data: Uint8Array;
      try {
        data = await reader.read(offsets[i]!, size);
      } catch {
        data = await reader.read(offsets[i]!, size); // one retry; a second failure propagates
      }
      if (data.length < 2) throw new Error("chapter title unreadable");
      const length = Math.min(u16(data, 0), data.length - 2);
      chapters[i] = { start: starts[i] ?? 0, title: cleanTitle(decodeTitle(data.subarray(2, 2 + length)), i) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(TITLE_READ_CONCURRENCY, offsets.length) }, worker));
  return chapters.filter((c): c is Chapter => c !== null);
}

// ---- entry point ------------------------------------------------------------------------

function normalize(chapters: Chapter[]): Chapter[] {
  const sorted = chapters
    .filter((c) => Number.isFinite(c.start) && c.start >= 0)
    .sort((a, b) => a.start - b.start)
    .filter((c, i, all) => i === 0 || c.start - all[i - 1]!.start > 0.25);
  return sorted.slice(0, MAX_CHAPTERS);
}

// Returns the chapters (≥ 2), or null when the file has none or isn't MP4.
// Throws when bytes couldn't be read — callers should retry later rather than
// remember "no chapters".
export async function readMp4Chapters(reader: Reader): Promise<Chapter[] | null> {
  const first = await readBoxHeader(reader, 0, reader.size() ?? Number.MAX_SAFE_INTEGER);
  if (!first || first.type !== "ftyp") return null;
  let moov: Box | undefined;
  let offset = 0;
  for (let i = 0; i < MAX_TOP_LEVEL_BOXES; i++) {
    const limit = reader.size() ?? Number.MAX_SAFE_INTEGER;
    if (offset >= limit) break;
    const box = await readBoxHeader(reader, offset, limit);
    if (!box) break;
    if (box.type === "moov") { moov = box; break; }
    offset += box.size;
  }
  if (!moov) return null;
  const moovKids = await children(reader, moov);

  const tracks: Track[] = [];
  for (const trak of moovKids.filter((box) => box.type === "trak")) tracks.push(await describeTrack(reader, trak));
  const referenced = new Set(tracks.flatMap((t) => t.chapterRefs));
  const chapterTrack = tracks.find((t) => t.id !== undefined && referenced.has(t.id) && t.handler !== "soun" && t.handler !== "vide");
  if (chapterTrack) {
    const chapters = normalize(await readChapterTrack(reader, chapterTrack));
    if (chapters.length >= 2) return chapters;
  }

  const udta = find(moovKids, "udta");
  if (udta) {
    const chpl = find(await children(reader, udta), "chpl");
    if (chpl) {
      const chapters = normalize(parseChpl(await body(reader, chpl)));
      if (chapters.length >= 2) return chapters;
    }
  }
  return null;
}
