import { PlaybackSession, smartRewindSeconds } from "../session";
import type { NativePlayerPort, NativeSleepTimer, PlaybackBook, PlaybackEvent, PlaybackFile } from "../types";

const local: PlaybackBook = { id: "book", title: "Book", files: [{ filename: "one.m4b", uri: "file:///one.m4b" }] };
const streamed: PlaybackBook = { id: "stream", title: "Stream", files: [{ filename: "one.m4b", url: "https://cdn/old" }] };

function harness(options: { book?: PlaybackBook; smartRewind?: boolean; nativeTimer?: NativeSleepTimer | null; resolveStreams?: (id: string) => Promise<PlaybackFile[]> } = {}) {
  const book = options.book ?? local;
  let clock = 1_000_000;
  let position = 600;
  let playing = true;
  const listeners = new Map<PlaybackEvent, Set<(event: any) => void>>();
  const emit = (event: PlaybackEvent, payload: any) => listeners.get(event)?.forEach((listener) => listener(payload));
  const player: NativePlayerPort = {
    setup: jest.fn(async () => {}), configureCommands: jest.fn(async () => {}),
    getQueue: jest.fn(async () => [{ mediaId: `${book.id}:0` }]),
    getActiveIndex: jest.fn(async () => 0), getProgress: jest.fn(async () => ({ position, duration: 7200 })),
    getState: jest.fn(async () => "ready" as const), isPlaying: jest.fn(async () => playing), getRate: jest.fn(async () => 1),
    replaceQueue: jest.fn(async (items) => { if (items.length) setTimeout(() => emit("state", { state: "ready" }), 0); }),
    play: jest.fn(async () => { playing = true; }), pause: jest.fn(async () => { playing = false; }), stop: jest.fn(async () => {}),
    seekTo: jest.fn(async (p: number) => { position = p; }), seekBy: jest.fn(async (o: number) => { position += o; }),
    skipTo: jest.fn(async () => {}), setRate: jest.fn(async () => {}),
    sleepAfterTime: jest.fn(async () => {}), sleepAfterTrack: jest.fn(async () => {}), cancelSleep: jest.fn(async () => {}),
    ...(options.nativeTimer !== undefined ? { getSleepTimer: jest.fn(async () => options.nativeTimer ?? null) } : {}),
    subscribe: jest.fn((event, listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return () => listeners.get(event)?.delete(listener);
    }),
  };
  const writer = { enqueue: jest.fn(async () => {}), flush: jest.fn(async () => {}) };
  const sessions = { get: jest.fn(async () => null), clear: jest.fn(async () => {}) };
  const session = new PlaybackSession({
    player, sessions, library: { get: async () => book }, writer, now: () => clock,
    smartRewind: () => options.smartRewind ?? true,
    ...(options.resolveStreams ? { resolveStreams: options.resolveStreams } : {}),
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    session, player, writer, sessions, emit, settle,
    advance: (ms: number) => { clock += ms; },
    setPlaying: (value: boolean) => { playing = value; },
    position: () => position,
  };
}

describe("smart rewind", () => {
  test("rewinds by pause length", () => {
    expect(smartRewindSeconds(5_000)).toBe(0);
    expect(smartRewindSeconds(30_000)).toBe(3);
    expect(smartRewindSeconds(10 * 60_000)).toBe(10);
    expect(smartRewindSeconds(8 * 3_600_000)).toBe(20);
  });

  test("in-app play steps back before resuming", async () => {
    const h = harness();
    await h.session.initialize();
    await h.session.pause();
    h.advance(45 * 60_000);
    await h.session.play();
    expect(h.player.seekTo).toHaveBeenCalledWith(580);
    expect(h.position()).toBe(580);
  });

  test("a resume handled natively (lock screen, headset) rewinds right after", async () => {
    const h = harness();
    await h.session.initialize();
    await h.session.pause();
    h.advance(5 * 60_000);
    h.setPlaying(true);
    h.emit("playing", { playing: true });
    await h.settle();
    expect(h.player.seekTo).toHaveBeenCalledWith(590);
    // The pause is consumed: later events don't rewind again.
    h.emit("playing", { playing: true });
    await h.settle();
    expect(h.player.seekTo).toHaveBeenCalledTimes(1);
  });

  test("seeking to a bookmark or chapter cancels the rewind", async () => {
    const h = harness();
    await h.session.initialize();
    await h.session.pause();
    h.advance(60 * 60_000);
    await h.session.seekTo(1234);
    await h.session.play();
    expect(h.player.seekTo).toHaveBeenCalledTimes(1);
    expect(h.position()).toBe(1234);
  });

  test("does nothing when the setting is off", async () => {
    const h = harness({ smartRewind: false });
    await h.session.initialize();
    await h.session.pause();
    h.advance(60 * 60_000);
    await h.session.play();
    expect(h.player.seekTo).not.toHaveBeenCalled();
  });
});

describe("sleep", () => {
  test("a timer can fade out and remembers it in the snapshot", async () => {
    const h = harness();
    await h.session.initialize();
    await h.session.setSleep(15, { fadeOutSeconds: 30 });
    expect(h.player.sleepAfterTime).toHaveBeenCalledWith(900, 30);
    expect(h.session.getSnapshot().sleep).toEqual({ mode: "timer", endsAt: 1_000_000 + 900_000, fadeOutSeconds: 30 });
  });

  test("a chapter-end timer accepts fractional minutes", async () => {
    const h = harness();
    await h.session.initialize();
    await h.session.setSleep(2.5, { reason: "chapter" });
    expect(h.player.sleepAfterTime).toHaveBeenCalledWith(150);
    expect(h.session.getSnapshot().sleep).toMatchObject({ mode: "timer", reason: "chapter" });
  });

  test("re-adopting a live native session picks up its running timer", async () => {
    const h = harness({ nativeTimer: { type: "time", remainingSeconds: 120, fadeOutSeconds: 30 } });
    await h.session.initialize();
    expect(h.session.getSnapshot().sleep).toEqual({ mode: "timer", endsAt: 1_000_000 + 120_000, fadeOutSeconds: 30 });
  });
});

describe("unload", () => {
  test("saves the position, empties the native queue and forgets the session", async () => {
    const h = harness();
    await h.session.initialize();
    h.writer.enqueue.mockClear();
    await h.session.unload();
    expect(h.writer.enqueue).toHaveBeenCalledWith(expect.objectContaining({ libraryProgress: expect.objectContaining({ position: 600 }) }));
    expect(h.writer.flush).toHaveBeenCalled();
    expect(h.player.replaceQueue).toHaveBeenLastCalledWith([], 0);
    expect(h.sessions.clear).toHaveBeenCalled();
    expect(h.session.getSnapshot()).toMatchObject({ book: null, status: "idle", intent: "stopped" });
    // Late native events can't write progress for a closed book.
    h.writer.enqueue.mockClear();
    h.emit("progress", { position: 1 });
    await h.settle();
    expect(h.writer.enqueue).not.toHaveBeenCalled();
  });
});

describe("retry", () => {
  test("a failed stream re-resolves and resumes playing where it stopped", async () => {
    const resolveStreams = jest.fn(async () => [{ filename: "one.m4b", url: "https://cdn/fresh" }]);
    const h = harness({ book: streamed, resolveStreams });
    await h.session.initialize();
    await h.session.pause();
    await h.session.retry();
    expect(resolveStreams).toHaveBeenCalledWith("stream");
    expect(h.player.replaceQueue).toHaveBeenLastCalledWith([expect.objectContaining({ url: "https://cdn/fresh" })], 0);
    expect(h.player.seekTo).toHaveBeenLastCalledWith(600);
    expect(h.player.play).toHaveBeenCalled();
    expect(h.session.getSnapshot()).toMatchObject({ status: "playing", intent: "playing" });
    expect(h.session.getSnapshot().error).toBeUndefined();
  });

  test("a local book reloads in place", async () => {
    const h = harness();
    await h.session.initialize();
    await h.session.retry();
    expect(h.player.replaceQueue).toHaveBeenLastCalledWith([expect.objectContaining({ url: "file:///one.m4b" })], 0);
    expect(h.player.seekTo).toHaveBeenLastCalledWith(600);
    expect(h.player.play).toHaveBeenCalled();
  });

  test("an error clears once playback is healthy again", async () => {
    const h = harness({ book: streamed });
    await h.session.initialize();
    await h.session.handlePlaybackError(new Error("boom"));
    expect(h.session.getSnapshot()).toMatchObject({ status: "error", error: expect.objectContaining({ retryable: false }) });
    await h.session.play();
    expect(h.session.getSnapshot().error).toBeUndefined();
  });
});

describe("a load the native player never received", () => {
  test("is sent again after a few seconds of silence, and then plays", async () => {
    jest.useFakeTimers();
    try {
      const h = harness();
      await h.session.initialize();
      let calls = 0;
      // First command dropped (player still connecting): no events at all.
      // The resend is delivered and the queue becomes ready.
      (h.player.replaceQueue as jest.Mock).mockImplementation(async () => {
        calls++;
        if (calls === 2) setTimeout(() => h.emit("state", { state: "ready" }), 10);
      });
      const loading = h.session.loadBook({ ...local, id: "other" }, 0, 0);
      await jest.advanceTimersByTimeAsync(4_100);
      expect(h.player.replaceQueue).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(50);
      await loading;
      expect(h.session.getSnapshot()).toMatchObject({ status: "playing", book: expect.objectContaining({ id: "other" }) });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a load that answers is never sent twice", async () => {
    jest.useFakeTimers();
    try {
      const h = harness();
      await h.session.initialize();
      (h.player.replaceQueue as jest.Mock).mockImplementation(async () => {
        h.emit("state", { state: "buffering" }); // heard; slow stream still loading
        setTimeout(() => h.emit("state", { state: "ready" }), 8_000);
      });
      const loading = h.session.loadBook({ ...local, id: "slow" }, 0, 0);
      await jest.advanceTimersByTimeAsync(8_100);
      await loading;
      expect(h.player.replaceQueue).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("rewind after a sleep timer", () => {
  test("the next resume steps back a full minute, even after a short nap", async () => {
    const h = harness();
    await h.session.initialize();
    await h.session.play();
    h.setPlaying(false);
    h.emit("sleep", {});
    await h.settle();
    h.advance(20_000); // a smart rewind alone would be 3 s
    await h.session.play();
    expect(h.player.seekTo).toHaveBeenCalledWith(540);
    // Only once: the next pause is an ordinary one.
    await h.session.pause();
    h.advance(20_000);
    await h.session.play();
    expect(h.player.seekTo).toHaveBeenLastCalledWith(537);
  });

  test("not when you seek first, or with smart rewind off", async () => {
    const h = harness();
    await h.session.initialize();
    await h.session.play();
    h.emit("sleep", {});
    await h.settle();
    await h.session.seekTo(100);
    await h.session.play();
    expect(h.position()).toBe(100);
    const off = harness({ smartRewind: false });
    await off.session.initialize();
    await off.session.play();
    off.emit("sleep", {});
    await off.settle();
    await off.session.play();
    expect(off.player.seekTo).not.toHaveBeenCalled();
  });
});
