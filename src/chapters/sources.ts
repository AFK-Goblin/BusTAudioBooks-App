// Byte sources for the chapter reader: HTTP Range for streamed books, base64
// slices of the file for downloaded ones.
import * as FileSystem from "expo-file-system/legacy";
import type { ByteSource } from "./mp4";

export function remoteSource(url: string, fetcher: typeof fetch = fetch, timeoutMs = 15_000): ByteSource {
  let size: number | undefined;
  return {
    size: () => size,
    async read(offset, length) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(url, {
          headers: { Range: `bytes=${offset}-${offset + length - 1}` },
          signal: controller.signal,
        });
        if (response.status === 416) return new Uint8Array(0); // starts past the end
        if (response.status !== 206) {
          // A 200 would be the WHOLE file (hundreds of MB): drop it unread.
          controller.abort();
          throw new Error(`Range request refused (HTTP ${response.status})`);
        }
        const total = /\/(\d+)\s*$/.exec(response.headers.get("content-range") ?? "");
        if (total) size = Number(total[1]);
        return new Uint8Array(await response.arrayBuffer());
      } finally {
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
