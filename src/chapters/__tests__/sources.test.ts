import { remoteSource } from "../sources";
jest.mock("expo-file-system/legacy", () => ({}));

function transport(range = "bytes 0-3/100", chunks = [new Uint8Array([1, 2, 3, 4])], status = 206, contentLength: string | null = null) {
  let at = 0;
  const reader = { read: jest.fn(async () => at < chunks.length ? { done: false, value: chunks[at++] } : { done: true }), cancel: jest.fn(async () => {}), releaseLock: jest.fn() };
  const response = { status, headers: { get: (name: string) => name === "content-range" ? range : contentLength }, body: { getReader: () => reader }, arrayBuffer: jest.fn(async () => new Uint8Array(chunks.flatMap(c => Array.from(c))).buffer) };
  const fetcher = jest.fn(async (_url: any, _init: any) => response);
  return { reader, response, fetcher, source: remoteSource("https://cdn/book", fetcher as unknown as typeof fetch), aborted: () => fetcher.mock.calls[0]?.[1].signal.aborted };
}

test("reads fragmented ranges without buffering the entire response", async () => {
  const t = transport("bytes 0-3/100", [new Uint8Array([1, 2]), new Uint8Array([3, 4])]);
  expect(Array.from(await t.source.read(0, 4))).toEqual([1, 2, 3, 4]);
  expect(t.source.size()).toBe(100);
  expect(t.response.arrayBuffer).not.toHaveBeenCalled();
  expect(t.reader.releaseLock).toHaveBeenCalled();
});
test.each(["bytes 0-99/100", "bytes 1-4/100", "invalid", "bytes 0-3/2"])("rejects an invalid or oversized range %s before reading", async (range) => {
  const t = transport(range);
  await expect(t.source.read(0, 4)).rejects.toThrow();
  expect(t.reader.read).not.toHaveBeenCalled();
  expect(t.response.arrayBuffer).not.toHaveBeenCalled();
  expect(t.aborted()).toBe(true);
});
test("cancels a body that sends more bytes than promised", async () => {
  const t = transport("bytes 0-3/100", [new Uint8Array(5), new Uint8Array(5)]);
  await expect(t.source.read(0, 4)).rejects.toThrow();
  expect(t.reader.read).toHaveBeenCalledTimes(1);
  expect(t.reader.cancel).toHaveBeenCalled();
  expect(t.aborted()).toBe(true);
});
test("rejects truncated bodies", async () => {
  const t = transport("bytes 0-3/100", [new Uint8Array(2)]);
  await expect(t.source.read(0, 4)).rejects.toThrow();
  expect(t.aborted()).toBe(true);
});
test("accepts a shorter range at end of file", async () => {
  const t = transport("bytes 0-1/2", [new Uint8Array([1, 2])]);
  expect(Array.from(await t.source.read(0, 4))).toEqual([1, 2]);
});
test("rejects an oversized content length before reading", async () => {
  const t = transport("bytes 0-3/100", undefined, 206, "9999999");
  await expect(t.source.read(0, 4)).rejects.toThrow();
  expect(t.aborted()).toBe(true);
});
test.each([200, 416])("aborts unread HTTP %s bodies", async (status) => {
  const t = transport(undefined, undefined, status);
  if (status === 416) expect(await t.source.read(0, 4)).toHaveLength(0);
  else await expect(t.source.read(0, 4)).rejects.toThrow("HTTP 200");
  expect(t.aborted()).toBe(true);
  expect(t.response.arrayBuffer).not.toHaveBeenCalled();
});
