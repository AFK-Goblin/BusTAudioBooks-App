import { STORAGE_SCHEMA_VERSION, type PlaybackSessionRecord } from "../../domain/models";
import { queueRevision } from "../progressModel";
import { PlaybackSession } from "../session";
import type { NativeMediaItem, NativePlayerPort, PlaybackBook, PlaybackEvent, PlaybackStatus } from "../types";

const book: PlaybackBook = {
  id: "torbox:book:one", title: "Long Book", author: "Author", files: [{ title: "Full Book", filename: "book.mp3", url: "https://stream" }],
};

function saved(overrides: Partial<PlaybackSessionRecord> = {}): PlaybackSessionRecord {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION, itemId: book.id, queueRevision: queueRevision(book), activeTrackIndex: 0,
    positionSeconds: 54_321, rate: 1.25, intendedState: "playing", checkpointedAt: 100, ...overrides,
  };
}

function harness(options: { queue?: NativeMediaItem[]; stored?: PlaybackSessionRecord | null; state?: PlaybackStatus; playing?: boolean; recent?: any; defaultRate?: number; resolveStreams?: (bookId: string) => Promise<any[]> } = {}) {
  const listeners = new Map<PlaybackEvent, (payload: any) => void>();
  const player: NativePlayerPort = {
    setup: jest.fn(async () => {}), configureCommands: jest.fn(async () => {}),
    getQueue: jest.fn(async () => options.queue ?? []), getActiveIndex: jest.fn(async () => 0),
    getProgress: jest.fn(async () => ({ position: 777, duration: 100_800 })),
    getState: jest.fn(async () => options.state ?? "ready"), isPlaying: jest.fn(async () => options.playing ?? false), getRate: jest.fn(async () => 1.25),
    replaceQueue: jest.fn(async () => { listeners.get("state")?.({ state: "ready" }); }),
    play: jest.fn(async () => {}), pause: jest.fn(async () => {}), stop: jest.fn(async () => {}),
    seekTo: jest.fn(async () => {}), seekBy: jest.fn(async () => {}), skipTo: jest.fn(async () => {}), setRate: jest.fn(async () => {}),
    sleepAfterTime: jest.fn(async () => {}), sleepAfterTrack: jest.fn(async () => {}), cancelSleep: jest.fn(async () => {}),
    subscribe: jest.fn((event, listener) => { listeners.set(event, listener); return () => listeners.delete(event); }),
  };
  const sessions = { get: jest.fn(async () => options.stored ?? null), clear: jest.fn(async () => {}) };
  const library = {
    get: jest.fn(async (id: string) => id === book.id ? book : null),
    recent: jest.fn(async () => options.recent ?? null),
  };
  const writer = { enqueue: jest.fn(async () => {}), flush: jest.fn(async () => {}) };
  return { player, sessions, library, writer, listeners, instance: new PlaybackSession({
    player, sessions, library, writer, now: () => 1_000, defaultRate: () => options.defaultRate ?? 1,
    ...(options.resolveStreams ? { resolveStreams: options.resolveStreams } : {}),
  }) };
}

test("shares a concurrent initialization attempt and reuses it after success", async () => {
  const h = harness();
  await Promise.all([h.instance.initialize(), h.instance.initialize(), h.instance.initialize()]);
  await h.instance.initialize();
  expect(h.player.setup).toHaveBeenCalledTimes(1);
  expect(h.player.configureCommands).toHaveBeenCalledTimes(1);
});

test("retries initialization after a transient player setup failure", async () => {
  const h = harness();
  (h.player.setup as jest.Mock)
    .mockRejectedValueOnce(new Error("playback service unavailable"))
    .mockResolvedValueOnce(undefined);

  await expect(h.instance.initialize()).rejects.toThrow("playback service unavailable");
  expect(h.instance.getSnapshot()).toMatchObject({
    status: "error",
    error: { code: "initialization-failed", message: "playback service unavailable", retryable: true },
  });

  await expect(h.instance.initialize()).resolves.toMatchObject({ status: "idle" });
  expect(h.player.setup).toHaveBeenCalledTimes(2);
  expect(h.player.configureCommands).toHaveBeenCalledTimes(1);
  expect(h.instance.getSnapshot().error).toBeUndefined();
});

test("cleans up listeners from a later failed initialization before retrying", async () => {
  const h = harness();
  const active = new Map<PlaybackEvent, Set<(payload: any) => void>>();
  (h.player.subscribe as jest.Mock).mockImplementation((event: PlaybackEvent, listener: (payload: any) => void) => {
    if (!active.has(event)) active.set(event, new Set());
    active.get(event)!.add(listener);
    return () => active.get(event)?.delete(listener);
  });
  (h.player.getQueue as jest.Mock)
    .mockRejectedValueOnce(new Error("queue temporarily unavailable"))
    .mockResolvedValueOnce([]);

  await expect(h.instance.initialize()).rejects.toThrow("queue temporarily unavailable");
  expect([...active.values()].reduce((total, listeners) => total + listeners.size, 0)).toBe(0);

  await expect(h.instance.initialize()).resolves.toMatchObject({ status: "idle" });
  expect([...active.values()].map((listeners) => listeners.size)).toEqual([1, 1, 1, 1, 1, 1]);
});

test.each([[true, "playing"], [false, "paused"]] as const)("adopts a valid live queue with playing=%s as %s without replacing or seeking", async (playing, expected) => {
  const h = harness({ queue: [{ mediaId: `${book.id}:0`, extras: { bookId: book.id, trackIndex: 0 } }], state: "ready", playing });
  const snapshot = await h.instance.initialize();
  expect(h.player.replaceQueue).not.toHaveBeenCalled();
  expect(h.player.seekTo).not.toHaveBeenCalled();
  expect(snapshot).toMatchObject({ book, status: expected, intent: expected, positionSeconds: 777 });
  expect(h.writer.enqueue).toHaveBeenCalledWith(expect.objectContaining({ session: expect.objectContaining({ positionSeconds: 777 }) }));
});

test("adopts a buffering live queue using its durable playing intent", async () => {
  const h = harness({
    queue: [{ mediaId: `${book.id}:0` }], state: "buffering", playing: false,
    stored: saved({ intendedState: "playing" }),
  });
  const snapshot = await h.instance.initialize();
  expect(snapshot).toMatchObject({ status: "buffering", intent: "playing" });
});

test("cold-restores a long single-file book paused and rewinds five seconds after readiness", async () => {
  const h = harness({ stored: saved() });
  const snapshot = await h.instance.initialize();
  expect(h.player.replaceQueue).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ mediaId: `${book.id}:0` })]), 0);
  expect(h.player.seekTo).toHaveBeenCalledWith(54_316);
  expect(h.player.setRate).toHaveBeenCalledWith(1.25);
  expect(h.player.play).not.toHaveBeenCalled();
  expect(snapshot).toMatchObject({ book, status: "paused", intent: "paused", positionSeconds: 54_316 });
});

test("refreshes remote streams before rebuilding a cold-restored queue", async () => {
  const resolveStreams = jest.fn(async () => [{ title: "Full Book", filename: "book.mp3", url: "https://fresh" }]);
  const h = harness({ stored: saved(), resolveStreams });
  await h.instance.initialize();
  expect(resolveStreams).toHaveBeenCalledWith(book.id);
  expect(h.player.replaceQueue).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ url: "https://fresh" })]),
    0,
  );
});

test("does not restore into a refreshed remote queue whose stable identity changed", async () => {
  const resolveStreams = jest.fn(async () => [{ title: "Different", filename: "different.mp3", url: "https://fresh" }]);
  const h = harness({ stored: saved(), resolveStreams });
  await h.instance.initialize();
  expect(h.sessions.clear).toHaveBeenCalled();
  expect(h.player.replaceQueue).not.toHaveBeenCalled();
});

test("does not restore a session whose stable queue revision no longer matches", async () => {
  const h = harness({ stored: saved({ queueRevision: "stale" }) });
  const snapshot = await h.instance.initialize();
  expect(h.player.replaceQueue).not.toHaveBeenCalled();
  expect(h.sessions.clear).toHaveBeenCalled();
  expect(snapshot.status).toBe("idle");
});

test("migrates legacy Continue Listening progress when no session record exists", async () => {
  const recent = { ...book, progress: { trackIndex: 0, position: 7_200 } };
  const h = harness({ recent, defaultRate: 1.5 });
  const snapshot = await h.instance.initialize();
  expect(h.player.seekTo).toHaveBeenCalledWith(7_195);
  expect(h.player.setRate).toHaveBeenCalledWith(1.5);
  expect(snapshot).toMatchObject({ book: recent, positionSeconds: 7_195, status: "paused" });
  expect(h.writer.enqueue).toHaveBeenCalled();
});

test("tracks native pause and play intent for media controls and interruptions", async () => {
  const h = harness({ queue: [{ mediaId: `${book.id}:0` }], state: "ready", playing: true });
  await h.instance.initialize();
  h.listeners.get("playing")?.({ playing: false });
  await Promise.resolve();
  await Promise.resolve();
  expect(h.instance.getSnapshot()).toMatchObject({ status: "paused", intent: "paused" });
  h.listeners.get("playing")?.({ playing: true });
  await Promise.resolve();
  await Promise.resolve();
  expect(h.instance.getSnapshot()).toMatchObject({ status: "playing", intent: "playing" });
});

test("does not turn transient buffering into paused intent", async () => {
  const h = harness({ queue: [{ mediaId: `${book.id}:0` }], state: "buffering", playing: true });
  await h.instance.initialize();
  (h.player.isPlaying as jest.Mock).mockResolvedValue(false);
  h.listeners.get("playing")?.({ playing: false });
  await Promise.resolve();
  await Promise.resolve();
  expect(h.instance.getSnapshot()).toMatchObject({ status: "buffering", intent: "playing" });
});

test("rejects a book with no playable files without changing the native queue", async () => {
  const h = harness();
  await expect(h.instance.loadBook({ ...book, files: [] })).rejects.toThrow("No playable files");
  expect(h.player.replaceQueue).not.toHaveBeenCalled();
  expect(h.player.play).not.toHaveBeenCalled();
});

test("ignores an older native refresh that completes after a newer one", async () => {
  const h = harness({ queue: [{ mediaId: `${book.id}:0` }], playing: true });
  await h.instance.initialize();
  let releaseOlder!: (value: { position: number; duration: number }) => void;
  const older = new Promise<{ position: number; duration: number }>((resolve) => { releaseOlder = resolve; });
  (h.player.getProgress as jest.Mock)
    .mockImplementationOnce(() => older)
    .mockResolvedValueOnce({ position: 900, duration: 100_800 });
  const olderRefresh = h.instance.syncFromNative("older");
  const newerRefresh = h.instance.syncFromNative("newer");
  await newerRefresh;
  releaseOlder({ position: 800, duration: 100_800 });
  await olderRefresh;
  expect(h.instance.getSnapshot().positionSeconds).toBe(900);
  (h.player.getProgress as jest.Mock).mockResolvedValue({ position: 900, duration: 100_800 });
  h.listeners.get("progress")?.({ position: 800, duration: 100_800 });
  await Promise.resolve();
  await Promise.resolve();
  expect(h.instance.getSnapshot().positionSeconds).toBe(900);
});
