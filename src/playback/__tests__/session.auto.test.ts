import { PlaybackSession } from "../session";
import type { NativePlayerPort, PlaybackBook, PlaybackEvent } from "../types";

// Android Auto plays a book straight from the browse tree: the native queue
// changes under the session, starting at the top of the chosen part.
type Book = PlaybackBook & { progress?: { trackIndex?: number; position?: number; finished?: boolean } };
const A: Book = { id: "a", title: "A", files: [{ uri: "file:///a0" }, { uri: "file:///a1" }], progress: { trackIndex: 1, position: 600 } };
const B: Book = { id: "b", title: "B", files: [{ uri: "file:///b0" }], progress: { trackIndex: 0, position: 300 } };

function harness() {
  let queue: { mediaId: string }[] = [];
  let index = 0;
  let position = 0;
  let playing = false;
  const listeners = new Map<PlaybackEvent, Set<(event: any) => void>>();
  const emit = (event: PlaybackEvent, payload: any) => listeners.get(event)?.forEach((listener) => listener(payload));
  const player: NativePlayerPort = {
    setup: jest.fn(async () => {}), configureCommands: jest.fn(async () => {}),
    getQueue: jest.fn(async () => queue), getActiveIndex: jest.fn(async () => index),
    getProgress: jest.fn(async () => ({ position, duration: 3600 })),
    getState: jest.fn(async () => (playing ? "playing" as const : "ready" as const)), isPlaying: jest.fn(async () => playing), getRate: jest.fn(async () => 1),
    replaceQueue: jest.fn(async (items, start) => {
      queue = items.map((item: any) => ({ mediaId: item.mediaId }));
      index = start;
      if (items.length) setTimeout(() => emit("state", { state: "ready" }), 0);
    }),
    play: jest.fn(async () => { playing = true; }), pause: jest.fn(async () => { playing = false; }), stop: jest.fn(async () => {}),
    seekTo: jest.fn(async (p: number) => { position = p; }), seekBy: jest.fn(async (o: number) => { position += o; }),
    skipTo: jest.fn(async () => {}), setRate: jest.fn(async () => {}),
    sleepAfterTime: jest.fn(async () => {}), sleepAfterTrack: jest.fn(async () => {}), cancelSleep: jest.fn(async () => {}),
    subscribe: jest.fn((event, listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return () => listeners.get(event)?.delete(listener);
    }),
  };
  const writer = { enqueue: jest.fn(async () => {}), flush: jest.fn(async () => {}) };
  const books: Record<string, Book> = { a: A, b: B };
  const session = new PlaybackSession({
    player, sessions: { get: jest.fn(async () => null), clear: jest.fn(async () => {}) },
    library: { get: async (id: string) => books[id] ?? null }, writer, now: () => 1_000_000,
  });
  // What Android Auto does: its own queue, at the top of the chosen part.
  const carPlays = (book: Book, part: number) => {
    queue = book.files.map((_, i) => ({ mediaId: `${book.id}:${i}` }));
    index = part;
    position = 0;
    playing = true;
  };
  const savedFor = () => (writer.enqueue.mock.calls as any[]).map(([input]) => input.session.itemId);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { session, player, writer, emit, carPlays, savedFor, settle, setPosition: (p: number) => { position = p; } };
}

test("a book picked in the car is taken over and resumes where it was", async () => {
  const h = harness();
  await h.session.initialize();
  await h.session.loadBook(A, 1, 600, { play: false });
  h.writer.enqueue.mockClear();
  h.carPlays(B, 0);
  h.emit("transition", { item: { mediaId: "b:0" }, index: 0 });
  await h.settle();
  expect(h.session.getSnapshot()).toMatchObject({ book: B, activeTrackIndex: 0, positionSeconds: 295 });
  expect(h.player.seekTo).toHaveBeenLastCalledWith(295);
  expect(new Set(h.savedFor())).toEqual(new Set(["b"])); // nothing saved against A
});

test("in the background (no transition event), progress doesn't land on the old book", async () => {
  const h = harness();
  await h.session.initialize();
  await h.session.loadBook(A, 1, 600, { play: false });
  h.writer.enqueue.mockClear();
  h.carPlays(B, 0);
  h.setPosition(42); // already playing a while: no resume jump
  await h.session.syncFromNative("background-progress");
  expect(h.session.getSnapshot()).toMatchObject({ book: B, positionSeconds: 42 });
  expect(h.savedFor()).not.toContain("a");
});

test("after closing a book, the car can start it again", async () => {
  const h = harness();
  await h.session.initialize();
  await h.session.loadBook(A, 1, 600, { play: false });
  await h.session.unload();
  h.carPlays(A, 1);
  await h.session.syncFromNative("background-playing");
  expect(h.session.getSnapshot()).toMatchObject({ book: A, activeTrackIndex: 1, positionSeconds: 595 });
});

test("the app's own queue is never treated as someone else's", async () => {
  const h = harness();
  await h.session.initialize();
  await h.session.loadBook(A, 0, 0, { play: false });
  h.emit("transition", { item: { mediaId: "a:1" }, index: 1 });
  await h.settle();
  expect(h.player.seekTo).not.toHaveBeenCalledWith(595);
  expect(h.session.getSnapshot().book).toBe(A);
});
