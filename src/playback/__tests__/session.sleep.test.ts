import { PlaybackSession } from "../session";
import type { NativePlayerPort, PlaybackBook, PlaybackEvent } from "../types";

const book: PlaybackBook = {
  id: "book", title: "Book", files: [{ filename: "one.mp3", uri: "file:///one.mp3" }, { filename: "two.mp3", uri: "file:///two.mp3" }],
};

function harness() {
  const listeners = new Map<PlaybackEvent, (event: any) => void>();
  const player: NativePlayerPort = {
    setup: jest.fn(async () => {}), configureCommands: jest.fn(async () => {}), getQueue: jest.fn(async () => [{ mediaId: "book:0" }]),
    getActiveIndex: jest.fn(async () => 0), getProgress: jest.fn(async () => ({ position: 100, duration: 500 })),
    getState: jest.fn(async () => "ready"), isPlaying: jest.fn(async () => true), getRate: jest.fn(async () => 1),
    replaceQueue: jest.fn(async () => {}), play: jest.fn(async () => {}), pause: jest.fn(async () => {}), stop: jest.fn(async () => {}),
    seekTo: jest.fn(async () => {}), seekBy: jest.fn(async () => {}), skipTo: jest.fn(async () => {}), setRate: jest.fn(async () => {}),
    sleepAfterTime: jest.fn(async () => {}), sleepAfterTrack: jest.fn(async () => {}), cancelSleep: jest.fn(async () => {}),
    subscribe: jest.fn((event, listener) => { listeners.set(event, listener); return () => listeners.delete(event); }),
  };
  const writer = { enqueue: jest.fn(async () => {}), flush: jest.fn(async () => {}) };
  const session = new PlaybackSession({ player, sessions: { get: async () => null, clear: async () => {} }, library: { get: async () => book }, writer });
  return { session, player, writer, listeners };
}

test("timer sleep pauses, clears itself, and checkpoints at expiry", async () => {
  const h = harness();
  await h.session.initialize();
  await h.session.setSleep(1);
  expect(h.player.sleepAfterTime).toHaveBeenCalledWith(60);
  h.writer.enqueue.mockClear();
  h.listeners.get("sleep")?.({ type: "time" });
  await Promise.resolve();
  await Promise.resolve();
  expect(h.session.getSnapshot().sleep).toEqual({ mode: "off" });
  expect(h.writer.enqueue).toHaveBeenCalled();
});

test("end-of-track sleep pauses only on a transition and clears itself", async () => {
  const h = harness();
  await h.session.initialize();
  await h.session.setSleep("end-of-track");
  expect(h.player.sleepAfterTrack).toHaveBeenCalledWith(0);
  h.listeners.get("sleep")?.({ type: "mediaItem" });
  await Promise.resolve();
  await Promise.resolve();
  expect(h.session.getSnapshot().sleep).toEqual({ mode: "off" });
});
