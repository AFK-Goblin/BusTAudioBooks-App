// Byte sources for the chapter reader: HTTP Range for streamed books, base64
// slices of the file for downloaded ones.
import * as FileSystem from "expo-file-system/legacy";
import type { ByteSource } from "./mp4";

export function remoteSource(url: string, fetcher: typeof fetch = fetch, timeoutMs = 15_000): ByteSource {
  let size: number | undefined;
  return {
    size: () => size,
    async read(offset, length) {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || length > 8 * 1024 * 1024 || !Number.isSafeInteger(offset + length)) {
        throw new Error("Invalid chapter byte range");
      }
      if (length === 0) return new Uint8Array(0);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await fetcher(url, {
          headers: { Range: `bytes=${offset}-${offset + length - 1}` },
          signal: controller.signal,
        });
        if (response.status === 416) {
          controller.abort();
          return new Uint8Array(0);
        }
        if (response.status !== 206) {
          throw new Error(`Range request refused (HTTP ${response.status})`);
        }
        const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(response.headers.get("content-range")?.trim() ?? "");
        const first = Number(range?.[1]);
        const last = Number(range?.[2]);
        const total = range?.[3] === "*" ? undefined : Number(range?.[3]);
        if (!range || first !== offset || !Number.isSafeInteger(last) || last < first || last >= offset + length ||
            (total !== undefined && (!Number.isSafeInteger(total) || total <= last))) {
          throw new Error("Invalid chapter Content-Range");
        }
        const expected = last - first + 1;
        const contentLength = response.headers.get("content-length");
        if (contentLength !== null && Number(contentLength) !== expected) throw new Error("Invalid chapter Content-Length");
        // Expo's streaming fetch lets us bound reads before collecting a body.
        // Never fall back to arrayBuffer(): a bad CDN response could be the book.
        if (!response.body) throw new Error("Chapter response has no readable body");
        reader = response.body.getReader();
        const bytes = new Uint8Array(expected);
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.byteLength > expected - received) throw new Error("Oversized chapter response");
          bytes.set(value, received);
          received += value.byteLength;
        }
        if (received !== expected) throw new Error("Truncated chapter response");
        if (total !== undefined) size = total;
        return bytes;
      } catch (error) {
        controller.abort();
        if (reader) void reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader?.releaseLock();
        clearTimeout(timer);
      }
    },
  };
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Map([...ALPHABET].map((c, i) => [c, i]));

export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const char of clean) {
    value = (value << 6) | (LOOKUP.get(char) ?? 0);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, at);
}

export async function localSource(uri: string): Promise<ByteSource> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new Error("Downloaded file is missing");
  const size = "size" in info && typeof info.size === "number" ? info.size : undefined;
  return {
    size: () => size,
    async read(offset, length) {
      const clamped = size === undefined ? length : Math.max(0, Math.min(length, size - offset));
      if (clamped === 0) return new Uint8Array(0);
      const text = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64, position: offset, length: clamped,
      });
      return decodeBase64(text);
    },
  };
}
