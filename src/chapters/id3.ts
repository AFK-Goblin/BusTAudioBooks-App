// Chapter markers in MP3 audiobooks: ID3v2.3/2.4 CHAP frames (each with a
// start time in ms and a TIT2 title sub-frame). The tag sits at the start of
// the file but can hold megabytes of cover art, so only frame headers and the
// CHAP bodies are read — APIC pictures are skipped, never fetched.
import { decodeTitle, type Chapter } from "./mp4";

type Reader = { read(offset: number, length: number): Promise<Uint8Array>; size(): number | undefined };

const MAX_FRAMES = 4000;
const MAX_CHAP_BYTES = 64 * 1024;

function syncsafe(b: Uint8Array, at: number): number {
  return ((b[at]! & 0x7f) << 21) | ((b[at + 1]! & 0x7f) << 14) | ((b[at + 2]! & 0x7f) << 7) | (b[at + 3]! & 0x7f);
}
function u32(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
}

export function startsWithId3(head: Uint8Array): boolean {
  return head.length >= 3 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33; // "ID3"
}

// ID3 text: one encoding byte, then the text (0 = Latin-1, 1 = UTF-16 with
// BOM, 2 = UTF-16BE, 3 = UTF-8), optionally NUL-terminated.
export function decodeId3Text(data: Uint8Array): string {
  if (data.length === 0) return "";
  const encoding = data[0];
  const body = data.subarray(1);
  if (encoding === 1 || encoding === 2) {
    let end = body.length - (body.length % 2);
    for (let i = 0; i + 1 < body.length; i += 2) if (body[i] === 0 && body[i + 1] === 0) { end = i; break; }
    const text = body.subarray(0, end);
    return encoding === 2 ? decodeTitle(new Uint8Array([0xfe, 0xff, ...text])) : decodeTitle(text);
  }
  const nul = body.indexOf(0);
  const text = nul >= 0 ? body.subarray(0, nul) : body;
  return encoding === 3 ? decodeTitle(text) : String.fromCharCode(...text);
}

// Parses one CHAP frame body: element id, start/end ms, offsets, sub-frames.
export function parseChapFrame(body: Uint8Array, version: number): { start: number; title?: string } | null {
  const idEnd = body.indexOf(0);
  if (idEnd < 0 || idEnd + 17 > body.length) return null;
  const start = u32(body, idEnd + 1) / 1000;
  let at = idEnd + 17;
  let title: string | undefined;
  while (at + 10 <= body.length) {
    const id = String.fromCharCode(body[at]!, body[at + 1]!, body[at + 2]!, body[at + 3]!);
    const size = version >= 4 ? syncsafe(body, at + 4) : u32(body, at + 4);
    if (!/^[A-Z0-9]{4}$/.test(id) || size <= 0 || at + 10 + size > body.length) break;
    if (id === "TIT2") title = decodeId3Text(body.subarray(at + 10, at + 10 + size)).trim();
    at += 10 + size;
  }
  return title ? { start, title } : { start };
}

// Chapters (≥ 2) from an ID3v2 tag, or null when there are none. Throws when
// bytes can't be read (the caller retries later instead of remembering "none").
export async function readId3Chapters(reader: Reader): Promise<Chapter[] | null> {
  const header = await reader.read(0, 10);
  if (!startsWithId3(header) || header.length < 10) return null;
  const version = header[3]!;
  const flags = header[5]!;
  if (version < 3 || version > 4) return null; // v2.2 has no CHAP frames
  if (flags & 0x80) return null; // whole-tag unsynchronisation: rare, unsupported
  const tagEnd = 10 + syncsafe(header, 6);
  let at = 10;
  if (flags & 0x40) {
    // Extended header: v2.4 size includes itself (syncsafe); v2.3 doesn't.
    const ext = await reader.read(at, 4);
    at += version >= 4 ? syncsafe(ext, 0) : u32(ext, 0) + 4;
  }
  const found: { start: number; title?: string }[] = [];
  for (let i = 0; i < MAX_FRAMES && at + 10 <= tagEnd; i++) {
    const head = await reader.read(at, 10);
    if (head.length < 10 || head[0] === 0) break; // padding
    const id = String.fromCharCode(head[0]!, head[1]!, head[2]!, head[3]!);
    const size = version >= 4 ? syncsafe(head, 4) : u32(head, 4);
    if (!/^[A-Z0-9]{4}$/.test(id) || size <= 0 || at + 10 + size > tagEnd) break;
    // v2.4 per-frame compression/encryption/unsync: can't read those bodies.
    const frameFlags = head[9]!;
    const unreadable = version >= 4 ? (frameFlags & 0x0f) !== 0 : (frameFlags & 0xc0) !== 0;
    if (id === "CHAP" && !unreadable && size <= MAX_CHAP_BYTES) {
      const chapter = parseChapFrame(await reader.read(at + 10, size), version);
      if (chapter) found.push(chapter);
    }
    at += 10 + size;
  }
  const chapters = found
    .filter((c) => Number.isFinite(c.start) && c.start >= 0)
    .sort((a, b) => a.start - b.start)
    .map((c, i) => ({ start: c.start, title: c.title || `Chapter ${i + 1}` }));
  return chapters.length >= 2 ? chapters : null;
}
