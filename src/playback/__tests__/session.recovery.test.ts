import { PlaybackSession } from "../session";
import type { NativePlayerPort, PlaybackBook, PlaybackEvent } from "../types";

const book: PlaybackBook = {
  id: "book", title: "Book", files: [{ filename: "one.mp3", url: "https://expired" }],
};

function harness() {
  let now = 1_000;
  const listeners = new Map<PlaybackEvent, (event: any) => void>();
  const player: NativePlayerPort = {
    setup: jest.fn(async () => {}), configureCommands: jest.fn(async () => {}),
    getQueue: jest.fn(async () => [{ mediaId: "book:0" }]), getActiveIndex: jest.fn(async () => 0),
    getProgress: jest.fn(async () => ({ position: 500, duration: 1_000 })), getState: jest.fn(async () => "ready"),
    isPlaying: jest.fn(async () => true),
    getRate: jest.fn(async () => 1.5),
    replaceQueue: jest.fn(async () => { listeners.get("state")?.({ state: "ready" }); }),
    play: jest.fn(async () => {}), pause: jest.fn(async () => {}), stop: jest.fn(async () => {}),
    seekTo: jest.fn(async () => {}), seekBy: jest.fn(async () => {}), skipTo: jest.fn(async () => {}), setRate: jest.fn(async () => {}),
    sleepAfterTime: jest.fn(async () => {}), sleepAfterTrack: jest.fn(async () => {}), cancelSleep: jest.fn(async () => {}),
    subscribe: jest.fn((event, listener) => { listeners.set(event, listener); return () => listeners.delete(event); }),
  };
  const resolveStreams = jest.fn(async () => [{ filename: "one.mp3", url: "https://fresh" }]);
  const writer = { enqueue: jest.fn(async () => {}), flush: jest.fn(async () => {}) };
  const session = new PlaybackSession({
    player, sessions: { get: async () => null, clear: async () => {} },
    library: { get: async () => book }, writer, now: () => now, resolveStreams,
  });
  return { session, player, listeners, resolveStreams, writer, setNow(value: number) { now = value; } };
}

test("recovers a streamed queue at the exact position, rate, and playing intent", async () => {
  const h = harness();
  await h.session.initialize();
  await h.session.handlePlaybackError(new Error("signed URL expired"));
  expect(h.resolveStreams).toHaveBeenCalledWith("book");
  expect(h.player.replaceQueue).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ url: "https://fresh" })]), 0);
  expect(h.player.seekTo).toHaveBeenCalledWith(500);
  expect(h.player.setRate).toHaveBeenCalledWith(1.5);
  expect(h.player.play).toHaveBeenCalled();
  expect(h.session.getSnapshot()).toMatchObject({ status: "playing", positionSeconds: 500 });
});

test("bounds automatic recovery to one attempt per 30 seconds", async () => {
  const h = harness();
  await h.session.initialize();
  await h.session.handlePlaybackError(new Error("first"));
  h.setNow(20_000);
  await h.session.handlePlaybackError(new Error("second"));
  expect(h.resolveStreams).toHaveBeenCalledTimes(1);
});

test("keeps timer state until the native sleep event clears it", async () => {
  const h = harness();
  await h.session.initialize();
  await h.session.setSleep(1);
  h.setNow(61_001);
  h.listeners.get("progress")?.({ position: 510, duration: 1_000 });
  await Promise.resolve(); await Promise.resolve();
  expect(h.session.getSnapshot().sleep).toMatchObject({ mode: "timer" });
  h.listeners.get("sleep")?.({ type: "time" });
  await Promise.resolve(); await Promise.resolve();
  expect(h.session.getSnapshot().sleep).toEqual({ mode: "off" });
});

test("keeps end-of-track state across transition until native sleep triggers", async () => {
  const h = harness();
  await h.session.initialize();
  await h.session.setSleep("end-of-track");
  h.listeners.get("transition")?.({ index: 1 });
  await Promise.resolve(); await Promise.resolve();
  expect(h.session.getSnapshot().sleep).toEqual({ mode: "end-of-track" });
  h.listeners.get("sleep")?.({ type: "mediaItem" });
  await Promise.resolve(); await Promise.resolve();
  expect(h.session.getSnapshot().sleep).toEqual({ mode: "off" });
});

test("end-of-track sleep ignores a transition event without a valid next index", async () => {
  const h = harness();
  await h.session.initialize();
  await h.session.setSleep("end-of-track");
  h.listeners.get("transition")?.({});
  await Promise.resolve(); await Promise.resolve();
  expect(h.player.pause).not.toHaveBeenCalled();
  expect(h.session.getSnapshot().sleep).toEqual({ mode: "end-of-track" });
});
