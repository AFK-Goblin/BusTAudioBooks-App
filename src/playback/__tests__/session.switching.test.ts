import AsyncStorage from "@react-native-async-storage/async-storage";
import { STORAGE_SCHEMA_VERSION } from "../../domain/models";
import { checkpointAudiobookProgress, continueListening, getBook, upsertBook } from "../../library";
import { SessionRepository } from "../../repositories/sessionRepository";
import { CheckpointWriter } from "../checkpointWriter";
import { buildMediaItems } from "../config";
import { queueRevision } from "../progressModel";
import { PlaybackSession } from "../session";
import type { NativeMediaItem, NativePlayerPort, NativeProgress, PlaybackBook, PlaybackEvent, PlaybackStatus } from "../types";

const first: PlaybackBook = { id: "book:first", title: "First", files: [{ filename: "first.mp3", uri: "file:///first.mp3" }] };
const second: PlaybackBook = { id: "book:second", title: "Second", files: [{ filename: "second.m4b", uri: "file:///second.m4b" }] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function harness(options: { replacementEvents?: boolean; replacementReady?: boolean; replacementError?: string; coldRestorePosition?: number; deferInitialize?: boolean; firstBook?: PlaybackBook; resolveStreams?: (bookId: string) => Promise<PlaybackBook["files"]> } = {}) {
  const initialBook = options.firstBook ?? first;
  await upsertBook(initialBook);
  await upsertBook(second);
  const listeners = new Map<PlaybackEvent, Set<(event: any) => void>>();
  const emit = (event: PlaybackEvent, payload: any) => listeners.get(event)?.forEach((listener) => listener(payload));
  let queue: NativeMediaItem[] = options.coldRestorePosition == null ? buildMediaItems(initialBook) : [];
  let index = 0;
  let progress = { position: 600, duration: 7_200 };
  let state: PlaybackStatus = "ready";
  let playing = true;
  let onReplace: (() => Promise<void>) | undefined;
  let replacementError = options.replacementError;
  const player: NativePlayerPort = {
    setup: async () => {}, configureCommands: async () => {},
    getQueue: async () => queue, getActiveIndex: async () => index,
    getProgress: jest.fn(async () => ({ ...progress })),
    getState: async () => state, isPlaying: async () => playing, getRate: async () => 1,
    replaceQueue: jest.fn(async (items, startIndex) => {
      queue = items; index = startIndex;
      progress = { position: 0, duration: 0 }; state = "buffering"; playing = false;
      // Queue replacement really emits to BOTH the permanent session listeners
      // and the temporary readiness listener. A single-listener mock hides this bug.
      if (options.replacementEvents !== false) {
        emit("state", { state });
        emit("transition", { mediaItem: items[index], index });
        emit("playing", { playing });
        emit("progress", progress);
      }
      await onReplace?.();
      if (replacementError) {
        state = "error";
        emit("error", { message: replacementError });
        return;
      }
      if (options.replacementReady !== false) {
        state = "ready";
        emit("state", { state });
      }
    }),
    play: async () => { playing = true; emit("playing", { playing }); },
    pause: async () => { playing = false; }, stop: async () => { state = "idle"; playing = false; },
    seekTo: jest.fn(async (position: number) => { progress = { ...progress, position }; }),
    seekBy: async (offset) => { progress.position += offset; },
    skipTo: async (next) => { index = next; progress.position = 0; }, setRate: async () => {},
    sleepAfterTime: async () => {}, sleepAfterTrack: async () => {}, cancelSleep: async () => {},
    subscribe: (event, listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return () => { listeners.get(event)!.delete(listener); };
    },
  };
  const sessions = new SessionRepository();
  const writer = new CheckpointWriter(sessions, { checkpoint: checkpointAudiobookProgress });
  if (options.coldRestorePosition != null) {
    await checkpointAudiobookProgress(initialBook.id, {
      position: options.coldRestorePosition, duration: 7_200, trackIndex: 0, finished: false,
    });
    await sessions.checkpoint({
      schemaVersion: STORAGE_SCHEMA_VERSION, itemId: initialBook.id, queueRevision: queueRevision(initialBook),
      activeTrackIndex: 0, positionSeconds: options.coldRestorePosition, rate: 1,
      intendedState: "paused", checkpointedAt: 1_000,
    });
  }
  const session = new PlaybackSession({
    player, sessions, writer, library: { get: getBook },
    ...(options.resolveStreams ? { resolveStreams: options.resolveStreams } : {}),
  });
  const initialize = session.initialize();
  if (!options.deferInitialize) await initialize;
  return {
    session, initialize, player, writer, sessions, emit,
    setProgress(position: number, duration = 7_200) { progress = { position, duration }; },
    onReplace(callback: () => Promise<void>) { onReplace = callback; },
    setReplacementError(message?: string) { replacementError = message; },
  };
}

beforeEach(async () => { await AsyncStorage.clear(); });

test("switching books preserves each latest position and keeps both in Continue Listening", async () => {
  const h = await harness();
  h.setProgress(645); // Playback advanced since the last saved event.
  await h.session.loadBook(second);
  await h.writer.flush();
  expect((await getBook(first.id)).progress).toMatchObject({ position: 645, duration: 7_200, finished: false });

  h.setProgress(300, 14_400);
  await h.session.syncFromNative("progress");
  expect((await continueListening()).map((book) => book.id)).toEqual(expect.arrayContaining([first.id, second.id]));
  const savedFirst = await getBook(first.id);
  await h.session.loadBook(savedFirst, savedFirst.progress.trackIndex, savedFirst.progress.position);
  expect(h.player.seekTo).toHaveBeenLastCalledWith(640);
  expect((await getBook(second.id)).progress).toMatchObject({ position: 300, duration: 14_400, finished: false });
  expect((await continueListening()).map((book) => book.id)).toEqual(expect.arrayContaining([first.id, second.id]));
});

test("a resumed book does not inherit the previous book's short duration and become finished", async () => {
  const h = await harness({ replacementEvents: false });
  h.setProgress(30, 60);
  await h.session.syncFromNative("progress");
  await h.session.loadBook(second, 0, 3_600, { play: false });
  expect(h.session.getSnapshot()).toMatchObject({ book: second, positionSeconds: 3_595, durationSeconds: 0 });
  expect((await getBook(second.id)).progress).toMatchObject({ position: 3_595, duration: 0, finished: false });
  expect((await continueListening()).map((book) => book.id)).toContain(second.id);
});

test("background callbacks during replacement cannot overwrite the outgoing book", async () => {
  const h = await harness();
  h.setProgress(645);
  h.onReplace(async () => {
    await h.session.syncFromNative("background-progress");
    h.emit("state", { state: "idle" });
    await h.session.checkpoint("app-background");
    await h.writer.flush();
    expect((await getBook(first.id)).progress).toMatchObject({ position: 645, finished: false });
  });
  await h.session.loadBook(second);
  expect((await getBook(first.id)).progress.position).toBe(645);
});

test("an outgoing native read that completes after the switch cannot change the incoming book", async () => {
  const h = await harness({ replacementEvents: false });
  const old = deferred<NativeProgress>();
  (h.player.getProgress as jest.Mock).mockImplementationOnce(() => old.promise);
  const pendingRead = h.session.syncFromNative("late-progress");
  // Suppress the ordinary play event to leave the old refresh as the last one.
  h.player.play = async () => {};
  await h.session.loadBook(second, 0, 900, { play: false });
  old.resolve({ position: 680, duration: 7_200 });
  await pendingRead;
  expect(h.session.getSnapshot()).toMatchObject({ book: second, positionSeconds: 895 });
  expect((await getBook(second.id)).progress.position).toBe(895);
});


test("rapid book selections finish in order without mixing their saved positions", async () => {
  const h = await harness();
  const replacing = deferred<void>();
  const release = deferred<void>();
  h.setProgress(645);
  let replacements = 0;
  h.onReplace(async () => {
    if (++replacements === 1) { replacing.resolve(); await release.promise; }
  });
  const toSecond = h.session.loadBook(second, 0, 900);
  await replacing.promise;
  const backToFirst = h.session.loadBook(first, 0, 645);
  release.resolve();
  await Promise.all([toSecond, backToFirst]);
  expect(h.session.getSnapshot()).toMatchObject({ book: first, positionSeconds: 640 });
  expect((await getBook(second.id)).progress.position).toBe(895);
  expect((await getBook(first.id)).progress.position).toBe(640);
  expect((await h.sessions.get())?.itemId).toBe(first.id);
});

test("a rejected queue change preserves progress and permits the next book selection", async () => {
  const h = await harness();
  h.setProgress(645);
  (h.player.replaceQueue as jest.Mock).mockRejectedValueOnce(new Error("queue unavailable"));
  await expect(h.session.loadBook(second)).rejects.toThrow("queue unavailable");
  expect((await getBook(first.id)).progress.position).toBe(645);
  await h.session.loadBook(second, 0, 900);
  expect(h.session.getSnapshot()).toMatchObject({ book: second, positionSeconds: 895 });
  expect((await getBook(first.id)).progress.position).toBe(645);
});

test("a partially failed switch cannot save the incoming queue's progress against the old book", async () => {
  const h = await harness();
  h.setProgress(645);
  h.onReplace(async () => { throw new Error("new media unavailable"); });
  await expect(h.session.loadBook(second)).rejects.toThrow("new media unavailable");
  h.setProgress(20, 100);
  await h.session.syncFromNative("background-progress");
  await h.writer.flush();
  expect((await getBook(first.id)).progress.position).toBe(645);
  expect((await h.sessions.get())?.itemId).toBe(first.id);
  h.onReplace(async () => {});
  await h.session.loadBook(second, 0, 900);
  expect(h.session.getSnapshot()).toMatchObject({ book: second, positionSeconds: 895 });
});


test.each([false, true])("an old stream refresh finishing after a book switch is ignored (failure=%s)", async (fails) => {
  const started = deferred<void>();
  const resolved = deferred<void>();
  const remote: PlaybackBook = { ...first, files: [{ filename: "first.mp3", url: "https://expired.invalid/book" }] };
  const h = await harness({ firstBook: remote, resolveStreams: async () => {
    started.resolve();
    await resolved.promise;
    if (fails) throw new Error("old stream unavailable");
    return [{ filename: "first.mp3", url: "https://fresh.invalid/book" }];
  } });
  const recovery = h.session.handlePlaybackError(new Error("expired"));
  await started.promise;
  await h.session.loadBook(second, 0, 900);
  resolved.resolve();
  await recovery;
  expect(h.session.getSnapshot()).toMatchObject({ book: second, positionSeconds: 895, status: "playing" });
  expect(h.player.replaceQueue).toHaveBeenCalledTimes(1);
  expect((await getBook(first.id)).progress.position).toBe(600);
  expect((await getBook(second.id)).progress.position).toBe(895);
});


test("a native preparation error rejects the switch without losing the previous resume point", async () => {
  const h = await harness();
  h.setProgress(645);
  h.onReplace(async () => { h.emit("error", { message: "Unreadable media" }); });
  await expect(h.session.loadBook(second, 0, 900)).rejects.toThrow();
  expect(h.session.getSnapshot().status).toBe("error");
  expect((await getBook(first.id)).progress.position).toBe(645);
  expect((await h.sessions.get())?.itemId).toBe(first.id);
});

test("an old recovery read finishing after a book switch cannot leave the new book reconnecting", async () => {
  const remote: PlaybackBook = { ...first, files: [{ filename: "first.mp3", url: "https://expired.invalid/book" }] };
  const resolveStreams = jest.fn(async () => [{ filename: "first.mp3", url: "https://fresh.invalid/book" }]);
  const h = await harness({ firstBook: remote, resolveStreams });
  const old = deferred<NativeProgress>();
  (h.player.getProgress as jest.Mock).mockImplementationOnce(() => old.promise);
  const recovery = h.session.handlePlaybackError(new Error("expired"));
  await h.session.loadBook(second, 0, 900);
  old.resolve({ position: 650, duration: 7_200 });
  await recovery;
  expect(h.session.getSnapshot()).toMatchObject({ book: second, status: "playing", positionSeconds: 895 });
  expect(resolveStreams).not.toHaveBeenCalled();
});

test("a readiness timeout rejects the switch and releases its timers", async () => {
  jest.useFakeTimers();
  try {
    const h = await harness({ replacementReady: false });
    const started = deferred<void>();
    h.onReplace(async () => { started.resolve(); });
    const loading = h.session.loadBook(second);
    const failure = expect(loading).rejects.toThrow("Timed out");
    await started.promise;
    await jest.advanceTimersByTimeAsync(15_000);
    await failure;
    expect(jest.getTimerCount()).toBe(0);
    expect((await getBook(first.id)).progress.position).toBe(600);
  } finally {
    jest.useRealTimers();
  }
});


test("a failed cold restore preserves progress and allows another book to load", async () => {
  const h = await harness({ coldRestorePosition: 645, replacementError: "Unreadable saved media", deferInitialize: true });
  await expect(h.initialize).resolves.toMatchObject({ book: null, status: "error" });
  h.setProgress(0, 0);
  await h.session.syncFromNative("background-progress");
  await h.writer.flush();
  expect((await getBook(first.id)).progress).toMatchObject({ position: 645, finished: false });
  expect((await continueListening()).map((book) => book.id)).toContain(first.id);
  expect((await h.sessions.get())?.positionSeconds).toBe(645);

  h.setReplacementError(undefined);
  await h.session.loadBook(second, 0, 900);
  expect(h.session.getSnapshot()).toMatchObject({ book: second, positionSeconds: 895, status: "playing" });
  expect((await getBook(second.id)).progress.position).toBe(895);
});
