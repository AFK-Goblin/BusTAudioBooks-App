import { STORAGE_SCHEMA_VERSION, type PlaybackSessionRecord } from "../domain/models";
import { buildMediaItems, parseMediaId } from "./config";
import type { CheckpointInput, LibraryProgressCheckpoint } from "./checkpointWriter";
import { isBookFinished, queueRevision } from "./progressModel";
import type { NativeMediaItem, NativePlayerPort, PlaybackBook, PlaybackFile, PlaybackIntent, PlaybackSleep, PlaybackSnapshot, PlaybackStatus, SleepOptions, Unsubscribe } from "./types";

type SessionStore = { get(): Promise<PlaybackSessionRecord | null>; clear(): Promise<void> };
type LegacyPlaybackBook = PlaybackBook & { progress?: { trackIndex?: number; position?: number } };
type LibraryStore = {
  get(id: string): Promise<PlaybackBook | null>;
  recent?(): Promise<LegacyPlaybackBook | null>;
};
type Writer = { enqueue(input: CheckpointInput): Promise<void>; flush(): Promise<void> };
type Dependencies = {
  player: NativePlayerPort;
  sessions: SessionStore;
  library: LibraryStore;
  writer: Writer;
  now?: () => number;
  playerConfig?: unknown | (() => unknown);
  commands?: unknown | (() => unknown);
  resolveStreams?: (bookId: string) => Promise<PlaybackFile[]>;
  defaultRate?: () => number;
  smartRewind?: () => boolean;
};

const initialSnapshot: PlaybackSnapshot = {
  status: "idle", intent: "stopped", book: null, activeTrackIndex: 0,
  positionSeconds: 0, durationSeconds: 0, rate: 1, sleep: { mode: "off" },
};

// Smart rewind: how far to step back when resuming, by how long playback was
// paused. Brief interruptions (and the momentary pauses of seeks and part
// changes) cost nothing; returning after falling asleep re-hears the context.
export function smartRewindSeconds(pausedForMs: number): number {
  if (!(pausedForMs >= 10_000)) return 0;
  if (pausedForMs < 2 * 60_000) return 3;
  if (pausedForMs < 30 * 60_000) return 10;
  return 20;
}

// After a sleep timer stops playback you were probably asleep before it
// fired: the next resume steps back at least this far.
export const SLEEP_REWIND_SECONDS = 60;

const RESEND_SILENT_QUEUE_MS = 4_000;
// A queue started this close to the top of a part was started from the top
// (not resumed): adopting it continues from the saved place instead.
const RESUME_FROM_TOP_SECONDS = 5;

function isRemote(book: PlaybackBook): boolean {
  return book.files.length > 0 && book.files.every((file) => !file.uri && /^https:\/\//i.test(file.url ?? ""));
}

export class PlaybackSession {
  private snapshot: PlaybackSnapshot = { ...initialSnapshot };
  private initializing: Promise<PlaybackSnapshot> | undefined;
  private readonly listeners = new Set<(snapshot: PlaybackSnapshot) => void>();
  private nativeUnsubscribes: Unsubscribe[] = [];
  private readonly now: () => number;
  private recovery: Promise<void> | undefined;
  private lastRecoveryAt = Number.NEGATIVE_INFINITY;
  private nativeRefreshGeneration = 0;
  private changingQueue = false;
  private queueChanges: Promise<void> = Promise.resolve();
  // When listening last stopped, for smart rewind. Cleared by explicit
  // navigation (seek/skip) and queue changes: those choose a position.
  private pausedAt: number | undefined;
  private pausedBySleep = false;
  // The book whose queue this session last gave the player (or took over).
  // A queue of any other book was put there by someone else (Android Auto).
  private ownQueueBookId: string | null = null;

  constructor(private readonly deps: Dependencies) {
    this.now = deps.now ?? Date.now;
  }

  initialize(): Promise<PlaybackSnapshot> {
    if (!this.initializing) {
      if (this.snapshot.error?.code === "initialization-failed") {
        this.emit({ status: this.snapshot.book ? "loading" : "idle" });
      }
      this.initializing = this.initializeOnce().catch((error) => {
        this.initializing = undefined;
        this.unregisterNativeListeners();
        this.emit({
          status: "error",
          error: {
            code: "initialization-failed",
            message: error instanceof Error ? error.message : "Playback could not be initialized",
            retryable: true,
          },
        });
        throw error;
      });
    }
    return this.initializing;
  }

  getSnapshot(): PlaybackSnapshot { return { ...this.snapshot }; }

  subscribe(listener: (snapshot: PlaybackSnapshot) => void): Unsubscribe {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private emit(patch: Partial<PlaybackSnapshot>): void {
    const wasPlaying = this.snapshot.intent === "playing";
    const next = { ...this.snapshot, ...patch };
    // An error describes the status that carried it; any other status supersedes it.
    if (patch.status && patch.status !== "error" && !patch.error) delete next.error;
    if (wasPlaying && next.intent !== "playing") this.pausedAt ??= this.now();
    this.snapshot = next;
    this.listeners.forEach((listener) => listener(this.getSnapshot()));
  }

  // Takes the pending pause (so it can apply only once) and steps back.
  private async applySmartRewind(): Promise<void> {
    const pausedAt = this.pausedAt;
    const bySleep = this.pausedBySleep;
    this.forgetPause();
    if (pausedAt === undefined || !this.snapshot.book || !this.deps.smartRewind?.()) return;
    const seconds = Math.max(smartRewindSeconds(this.now() - pausedAt), bySleep ? SLEEP_REWIND_SECONDS : 0);
    if (seconds <= 0) return;
    const { position } = await this.deps.player.getProgress();
    if (position > 0) await this.deps.player.seekTo(Math.max(0, position - seconds));
  }

  // A seek, skip or new queue picks its own position: no rewind owed.
  private forgetPause(): void {
    this.pausedAt = undefined;
    this.pausedBySleep = false;
  }

  private async initializeOnce(): Promise<PlaybackSnapshot> {
    await this.deps.player.setup(valueOf(this.deps.playerConfig));
    await this.deps.player.configureCommands(valueOf(this.deps.commands));
    this.registerNativeListeners();
    const queue = await this.deps.player.getQueue();
    if (queue.length > 0) {
      const identities = queue.map((item) => parseMediaId(item.mediaId));
      const first = identities[0];
      if (first && identities.every((identity, index) => identity?.bookId === first.bookId && identity.trackIndex === index)) {
        const book = await this.deps.library.get(first.bookId);
        if (book) {
          await this.adoptLive(book, true);
          return this.getSnapshot();
        }
      }
      this.ownQueueBookId = null;
      await this.deps.player.replaceQueue([], 0);
    }
    try {
      await this.restorePersisted();
    } catch (error) {
      // Player setup succeeded, so keep initialization usable. The durable
      // checkpoint remains available for a later retry or explicit selection.
      this.emit({
        book: null, status: "error", intent: "stopped", positionSeconds: 0, durationSeconds: 0,
        error: { code: "media-unavailable", message: error instanceof Error ? error.message : "Saved media could not be restored", retryable: true },
      });
    }
    return this.getSnapshot();
  }

  private registerNativeListeners(): void {
    if (this.nativeUnsubscribes.length > 0) return;
    this.nativeUnsubscribes = [
      this.deps.player.subscribe("progress", () => {
        if (!this.snapshot.book) return;
        void this.refreshFromNative("progress");
      }),
      this.deps.player.subscribe("state", (event) => {
        if (this.changingQueue) return;
        const status = normalizeEventState(event?.state);
        const intent = status === "ended" || status === "idle" ? "stopped" : this.snapshot.intent;
        this.emit({ status: status === "ready" ? this.snapshot.status : status, intent });
        if (status === "ended" || status === "idle") void this.checkpoint("native-state");
      }),
      this.deps.player.subscribe("playing", (event) => {
        // Resumes from the lock screen, headset or audio focus are handled
        // natively, so smart rewind can only follow them (in-app play rewinds first).
        if (event?.playing && this.pausedAt !== undefined && !this.changingQueue) void this.applySmartRewind();
        void this.refreshFromNative("native-playing", Boolean(event?.playing));
      }),
      this.deps.player.subscribe("transition", (event) => {
        // An item from another book means someone else (Android Auto) changed
        // the queue: take it over before anything is saved against this book.
        const identity = parseMediaId(event?.item?.mediaId || "");
        if (identity && !this.changingQueue && identity.bookId !== this.snapshot.book?.id && identity.bookId !== this.ownQueueBookId) {
          void this.adoptForeignQueue().then((adopted) => { if (!adopted) void this.refreshFromNative("transition"); });
          return;
        }
        void this.refreshFromNative("transition");
      }),
      this.deps.player.subscribe("error", (event) => { void this.handlePlaybackError(event); }),
      this.deps.player.subscribe("sleep", () => { void this.handleSleepTriggered(); }),
    ];
  }

  private unregisterNativeListeners(): void {
    const unsubscribes = this.nativeUnsubscribes;
    this.nativeUnsubscribes = [];
    unsubscribes.forEach((unsubscribe) => unsubscribe());
  }

  // Android Auto starts a book's parts straight from the browse tree, without
  // this app. That queue is the book playing now: take it over (and resume it
  // where it was) rather than credit its progress to the book before.
  private async adoptForeignQueue(known?: NativeMediaItem[]): Promise<boolean> {
    if (this.changingQueue) return false;
    const queue = known ?? await this.deps.player.getQueue().catch(() => [] as NativeMediaItem[]);
    const bookId = this.foreignBookId(queue);
    if (!bookId) return false;
    const book = await this.deps.library.get(bookId);
    if (!book || this.changingQueue) return false;
    await this.adoptLive(book, true);
    return true;
  }

  // The book a whole-book queue belongs to, if that's not this session's own.
  private foreignBookId(queue: NativeMediaItem[] | null | undefined): string | null {
    const identities = (Array.isArray(queue) ? queue : []).map((item) => parseMediaId(item?.mediaId || ""));
    const first = identities[0];
    if (!first || !identities.every((identity, index) => identity?.bookId === first.bookId && identity.trackIndex === index)) return null;
    return first.bookId === this.ownQueueBookId || first.bookId === this.snapshot.book?.id ? null : first.bookId;
  }

  // resume: a queue someone else started at the top of a part (Android Auto)
  // continues from the saved place in that part.
  private async adoptLive(book: PlaybackBook, resume = false): Promise<void> {
    this.ownQueueBookId = book.id;
    const [activeTrackIndex, progress, nativeState, playing, rate, durable] = await Promise.all([
      this.deps.player.getActiveIndex(), this.deps.player.getProgress(), this.deps.player.getState(), this.deps.player.isPlaying(), this.deps.player.getRate(),
      this.deps.sessions.get().catch(() => null),
    ]);
    const buffering = nativeState === "buffering";
    const status: PlaybackStatus = buffering ? "buffering" : playing ? "playing" : nativeState === "ready" ? "paused" : nativeState;
    const durablePlaying = buffering && durable?.itemId === book.id && durable.intendedState === "playing";
    const intent: PlaybackIntent = playing || durablePlaying ? "playing" : status === "paused" ? "paused" : "stopped";
    const sleep = await this.nativeSleep(durable?.itemId === book.id ? durable.sleep : undefined);
    this.emit({ book, activeTrackIndex, positionSeconds: progress.position, durationSeconds: progress.duration, status, intent, rate, sleep });
    const saved = (book as PlaybackBook & { progress?: { position?: number; trackIndex?: number; finished?: boolean } }).progress;
    if (resume && saved && !saved.finished && (saved.trackIndex || 0) === activeTrackIndex
      && progress.position < RESUME_FROM_TOP_SECONDS && (saved.position || 0) > progress.position + RESUME_FROM_TOP_SECONDS) {
      const target = Math.max(0, (saved.position || 0) - 5);
      await this.deps.player.seekTo(target);
      this.emit({ positionSeconds: target });
    }
    await this.checkpoint("adopt-live");
  }

  // The native timer keeps running across a JS reload; describe it again so
  // the player shows the countdown instead of "Sleep off".
  private async nativeSleep(persisted?: PlaybackSessionRecord["sleep"]): Promise<PlaybackSleep> {
    // undefined = this player can't report timers; null = no timer running.
    const timer = this.deps.player.getSleepTimer ? await this.deps.player.getSleepTimer().catch(() => null) : undefined;
    if (timer?.type === "time" && timer.remainingSeconds > 0) {
      return {
        mode: "timer", endsAt: this.now() + timer.remainingSeconds * 1000,
        ...(timer.fadeOutSeconds ? { fadeOutSeconds: timer.fadeOutSeconds } : {}),
      };
    }
    if (timer?.type === "mediaItem") return { mode: "end-of-track" };
    if (timer === undefined && persisted?.mode === "end-of-track") return persisted;
    if (timer === undefined && persisted?.mode === "timer" && persisted.endsAt > this.now()) return persisted;
    return { mode: "off" };
  }

  private async restorePersisted(): Promise<void> {
    let stored: PlaybackSessionRecord | null;
    try { stored = await this.deps.sessions.get(); } catch { return; }
    let legacyBook: LegacyPlaybackBook | null = null;
    if (!stored) {
      legacyBook = await this.deps.library.recent?.() ?? null;
      const progress = legacyBook?.progress;
      if (!legacyBook || !(progress?.position && progress.position > 0)) return;
      stored = {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        itemId: legacyBook.id,
        queueRevision: queueRevision(legacyBook),
        activeTrackIndex: Math.max(0, progress.trackIndex ?? 0),
        positionSeconds: progress.position,
        rate: this.deps.defaultRate?.() ?? 1,
        intendedState: "paused",
        checkpointedAt: this.now(),
      };
    }
    const book = legacyBook ?? await this.deps.library.get(stored.itemId);
    if (!book || stored.queueRevision !== queueRevision(book) || stored.activeTrackIndex >= book.files.length) {
      await this.deps.sessions.clear();
      return;
    }
    const position = Math.max(0, stored.positionSeconds - 5);
    let playableBook = book;
    const remote = isRemote(book);
    if (remote && this.deps.resolveStreams) {
      try {
        const files = await this.deps.resolveStreams(book.id);
        if (files.length > 0) playableBook = { ...book, files };
      } catch {
        // Retain the known queue as a fallback; playback recovery can retry once
        // the native player reports that the stream is unavailable.
      }
    }
    if (queueRevision(playableBook) !== stored.queueRevision) {
      await this.deps.sessions.clear();
      return;
    }
    const restored = stored;
    await this.withQueueChange(async () => {
      this.emit({ status: "loading", book: playableBook, activeTrackIndex: restored.activeTrackIndex, rate: restored.rate });
      await this.replaceAndWait(buildMediaItems(playableBook), restored.activeTrackIndex);
      if (restored.positionSeconds > 0) await this.deps.player.seekTo(position);
      await this.deps.player.setRate(restored.rate);
      this.emit({ status: "paused", intent: "paused", positionSeconds: position, durationSeconds: 0 });
      await this.checkpoint("cold-restore", true);
    });
  }

  // Keep queue replacement and its restore seek together. Native callbacks may
  // already describe the incoming book while the snapshot still names the old one.
  private withQueueChange(operation: () => Promise<void>): Promise<void> {
    const run = this.queueChanges.then(async () => {
      this.changingQueue = true;
      ++this.nativeRefreshGeneration;
      try {
        await operation();
        // Loading a queue picks its own position — it is never a listening pause.
        this.forgetPause();
      } catch (error) {
        // Once replacement starts, native progress can belong to a queue that
        // never became ready. Detach it so no later callback can overwrite the
        // last durable position for either book.
        this.emit({
          book: null, status: "error", intent: "stopped", positionSeconds: 0, durationSeconds: 0,
          error: { code: "media-unavailable", message: error instanceof Error ? error.message : "Media could not be loaded", retryable: true },
        });
        throw error;
      } finally {
        ++this.nativeRefreshGeneration;
        this.changingQueue = false;
      }
    });
    this.queueChanges = run.catch(() => {});
    return run;
  }

  private async replaceAndWait(items: ReturnType<typeof buildMediaItems>, startIndex: number): Promise<void> {
    let unsubscribes: Unsubscribe[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resendTimer: ReturnType<typeof setTimeout> | undefined;
    let heard = false;
    const ready = new Promise<void>((resolve, reject) => {
      unsubscribes = [
        this.deps.player.subscribe("state", (event) => {
          heard = true;
          if (event?.state === "ready") resolve();
        }),
        this.deps.player.subscribe("transition", () => { heard = true; }),
        this.deps.player.subscribe("error", (event) => {
          reject(new Error(event?.message || "Media could not be prepared"));
        }),
      ];
      timer = setTimeout(() => reject(new Error("Timed out waiting for media to become ready")), 15_000);
    });
    this.ownQueueBookId = parseMediaId(items[0]?.mediaId || "")?.bookId ?? null;
    try {
      await this.deps.player.replaceQueue(items, startIndex);
      // A delivered queue always answers with a state change or an item
      // transition. Total silence means the native player dropped the command
      // (it was still connecting to its service): send it once more.
      resendTimer = setTimeout(() => {
        if (!heard) void this.deps.player.replaceQueue(items, startIndex).catch(() => {});
      }, RESEND_SILENT_QUEUE_MS);
      await ready;
    } finally {
      if (timer) clearTimeout(timer);
      if (resendTimer) clearTimeout(resendTimer);
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    }
  }

  async loadBook(book: PlaybackBook, trackIndex = 0, position = 0, options: { play?: boolean; rewindOnResume?: boolean } = {}): Promise<void> {
    if (book.files.length === 0) throw new Error("No playable files");
    await this.initialize();
    const index = Math.min(Math.max(0, trackIndex), Math.max(0, book.files.length - 1));
    const target = Math.max(0, position - (options.rewindOnResume === false ? 0 : 5));
    await this.withQueueChange(async () => {
      await this.refreshFromNative("before-load-book", undefined, true);
      await this.deps.writer.flush();
      await this.replaceAndWait(buildMediaItems(book), index);
      if (position > 0) await this.deps.player.seekTo(target);
      // Each book plays at the speed it was last played at; books never
      // played yet start at the default speed.
      const saved = (book as PlaybackBook & { progress?: { rate?: unknown } }).progress?.rate;
      const rate = typeof saved === "number" && Number.isFinite(saved) && saved > 0 ? saved : this.deps.defaultRate?.() ?? this.snapshot.rate;
      await this.deps.player.setRate(rate);
      this.emit({ book, activeTrackIndex: index, positionSeconds: target, durationSeconds: 0, rate, status: options.play === false ? "paused" : "playing", intent: options.play === false ? "paused" : "playing" });
      if (options.play !== false) await this.deps.player.play();
      await this.checkpoint("load-book", true);
    });
  }

  async play(): Promise<void> {
    await this.applySmartRewind();
    await this.deps.player.play();
    this.emit({ status: "playing", intent: "playing" });
    await this.checkpoint("play");
  }
  async pause(): Promise<void> { await this.deps.player.pause(); this.emit({ status: "paused", intent: "paused" }); await this.refreshFromNative("pause"); }
  async stop(): Promise<void> { await this.deps.player.stop(); this.emit({ status: "idle", intent: "stopped" }); await this.refreshFromNative("stop"); }
  // Explicit navigation picks the exact position, so it cancels smart rewind.
  async seekTo(position: number): Promise<void> { this.forgetPause(); await this.deps.player.seekTo(Math.max(0, position)); await this.refreshFromNative("seek"); }
  async seekBy(offset: number): Promise<void> { this.forgetPause(); await this.deps.player.seekBy(offset); await this.refreshFromNative("seek"); }
  async skipTo(index: number): Promise<void> { this.forgetPause(); await this.deps.player.skipTo(index); await this.refreshFromNative("skip"); }
  async setRate(rate: number): Promise<void> { await this.deps.player.setRate(rate); this.emit({ rate }); await this.checkpoint("rate"); }
  async configureCommands(commands: unknown): Promise<void> { await this.deps.player.configureCommands(commands); }
  async skipBy(offset: number): Promise<void> {
    const current = await this.deps.player.getActiveIndex();
    await this.skipTo(Math.max(0, current + offset));
  }
  async syncFromNative(reason: string): Promise<void> { await this.refreshFromNative(reason); }

  // value: minutes (fractions allowed, e.g. "until this chapter ends"), or
  // "end-of-track" for the end of the current part. 0 cancels.
  async setSleep(value: number | "end-of-track", options: SleepOptions = {}): Promise<void> {
    await this.deps.player.cancelSleep();
    let sleep: PlaybackSleep = { mode: "off" };
    if (value === "end-of-track") {
      sleep = { mode: "end-of-track" };
      await this.deps.player.sleepAfterTrack(await this.deps.player.getActiveIndex());
    }
    else if (value > 0) {
      const seconds = Math.max(1, Math.round(value * 60));
      const fade = Math.min(Math.max(0, options.fadeOutSeconds ?? 0), seconds);
      sleep = {
        mode: "timer", endsAt: this.now() + seconds * 1000,
        ...(fade > 0 ? { fadeOutSeconds: fade } : {}),
        ...(options.reason ? { reason: options.reason } : {}),
      };
      if (fade > 0) await this.deps.player.sleepAfterTime(seconds, fade);
      else await this.deps.player.sleepAfterTime(seconds);
    }
    this.emit({ sleep });
    await this.checkpoint("sleep");
  }

  // Retry after a failure the player surfaced (expired stream, lost network,
  // unreadable file). Streams are re-resolved; other books reload in place.
  async retry(): Promise<void> {
    await this.initialize();
    const book = this.snapshot.book;
    if (!book) {
      // Restoring the saved book failed at launch; try that again.
      try { await this.restorePersisted(); } catch { /* error state already emitted */ }
      return;
    }
    if (this.recovery) return this.recovery;
    this.lastRecoveryAt = this.now();
    const resolver = this.deps.resolveStreams;
    if (resolver && isRemote(book)) {
      this.recovery = this.recoverStream(book, resolver, "playing").finally(() => { this.recovery = undefined; });
      return this.recovery;
    }
    const index = this.snapshot.activeTrackIndex;
    const position = this.snapshot.positionSeconds;
    this.emit({ status: "loading" });
    await this.withQueueChange(async () => {
      await this.replaceAndWait(buildMediaItems(book), index);
      if (position > 0) await this.deps.player.seekTo(position);
      await this.deps.player.setRate(this.snapshot.rate);
      this.emit({ book, activeTrackIndex: index, positionSeconds: position, status: "playing", intent: "playing" });
      await this.deps.player.play();
      await this.checkpoint("retry", true);
    }).catch(() => { /* withQueueChange emitted the error state */ });
  }

  // Close the book: save where it stopped, then empty the native queue (which
  // dismisses the notification and mini player). Library progress is kept; the
  // book just isn't restored at the next launch.
  async unload(): Promise<void> {
    await this.initialize();
    if (!this.snapshot.book) return;
    await this.withQueueChange(async () => {
      await this.refreshFromNative("unload", undefined, true);
      await this.deps.writer.flush();
      await this.deps.player.cancelSleep();
      this.ownQueueBookId = null;
      await this.deps.player.replaceQueue([], 0);
      this.emit({ book: null, status: "idle", intent: "stopped", activeTrackIndex: 0, positionSeconds: 0, durationSeconds: 0, sleep: { mode: "off" } });
      await this.deps.sessions.clear();
    });
  }

  async handlePlaybackError(_error: unknown): Promise<void> {
    if (this.changingQueue) return;
    if (this.recovery) return this.recovery;
    const book = this.snapshot.book;
    const resolver = this.deps.resolveStreams;
    const remote = Boolean(book && isRemote(book));
    if (!book || !resolver || !remote || this.now() - this.lastRecoveryAt < 30_000) {
      this.emit({ status: "error", error: { code: remote ? "stream-unavailable" : "media-unavailable", message: "Playback unavailable", retryable: Boolean(remote && resolver) } });
      await this.checkpoint("error");
      return;
    }
    this.lastRecoveryAt = this.now();
    this.recovery = this.recoverStream(book, resolver).finally(() => { this.recovery = undefined; });
    return this.recovery;
  }

  private async recoverStream(book: PlaybackBook, resolver: (bookId: string) => Promise<PlaybackFile[]>, intentOverride?: PlaybackIntent): Promise<void> {
    const [activeTrackIndex, nativeProgress, rate] = await Promise.all([
      this.deps.player.getActiveIndex(), this.deps.player.getProgress(), this.deps.player.getRate(),
    ]);
    if (this.snapshot.book !== book) return;
    // A failed player can report position 0; the last good snapshot of the
    // same part knows better.
    const progress = nativeProgress.position > 0 || activeTrackIndex !== this.snapshot.activeTrackIndex
      ? nativeProgress
      : { position: this.snapshot.positionSeconds, duration: this.snapshot.durationSeconds };
    const intent = intentOverride ?? this.snapshot.intent;
    this.emit({ status: "reconnecting" });
    let recoveryBook = book;
    try {
      const files = await resolver(book.id);
      if (files.length === 0) throw new Error("No streams");
      const fresh = { ...book, files };
      await this.withQueueChange(async () => {
        if (this.snapshot.book !== book) return;
        await this.replaceAndWait(buildMediaItems(fresh), activeTrackIndex);
        await this.deps.player.seekTo(progress.position);
        await this.deps.player.setRate(rate);
        this.emit({
          book: fresh, activeTrackIndex, positionSeconds: progress.position, durationSeconds: progress.duration,
          rate, status: intent === "playing" ? "playing" : "paused", intent,
        });
        recoveryBook = fresh;
        if (intent === "playing") await this.deps.player.play();
        await this.checkpoint("recovery", true);
      });
    } catch {
      if (this.snapshot.book !== recoveryBook) return;
      this.emit({ status: "error", error: { code: "stream-recovery-failed", message: "Could not refresh this audiobook stream", retryable: true } });
      await this.checkpoint("recovery-failed");
    }
  }

  async handleSleepTriggered(): Promise<void> {
    this.emit({ sleep: { mode: "off" }, status: "paused", intent: "paused" });
    this.pausedAt ??= this.now();
    this.pausedBySleep = true;
    await this.refreshFromNative("sleep-triggered");
  }

  async checkpoint(_reason: string, duringQueueChange = false): Promise<void> {
    if (this.changingQueue && !duringQueueChange) return;
    const book = this.snapshot.book;
    if (!book) return;
    const finished = isBookFinished(this.snapshot.activeTrackIndex, book.files.length, this.snapshot.positionSeconds, this.snapshot.durationSeconds, this.snapshot.status === "ended");
    const libraryProgress: LibraryProgressCheckpoint = {
      position: this.snapshot.positionSeconds, duration: this.snapshot.durationSeconds,
      trackIndex: this.snapshot.activeTrackIndex, finished, rate: this.snapshot.rate,
    };
    await this.deps.writer.enqueue({
      session: {
        schemaVersion: STORAGE_SCHEMA_VERSION, itemId: book.id, queueRevision: queueRevision(book),
        activeTrackIndex: this.snapshot.activeTrackIndex, positionSeconds: this.snapshot.positionSeconds,
        rate: this.snapshot.rate, intendedState: this.snapshot.intent, checkpointedAt: this.now(),
        ...(this.snapshot.sleep.mode === "timer" ? { sleep: { mode: "timer" as const, endsAt: this.snapshot.sleep.endsAt } } :
          this.snapshot.sleep.mode === "end-of-track" ? { sleep: { mode: "end-of-track" as const } } : {}),
      },
      libraryProgress,
    });
  }

  private async refreshFromNative(reason: string, playingOverride?: boolean, duringQueueChange = false): Promise<void> {
    const book = this.snapshot.book;
    if (this.changingQueue && !duringQueueChange) return;
    // Nothing loaded here, yet the player plays: Android Auto may have started a book.
    if (!book) { if (!duringQueueChange) await this.adoptForeignQueue(); return; }
    const generation = ++this.nativeRefreshGeneration;
    const [activeTrackIndex, progress, nativeState, playing, queue] = await Promise.all([
      this.deps.player.getActiveIndex(), this.deps.player.getProgress(), this.deps.player.getState(), this.deps.player.isPlaying(),
      this.deps.player.getQueue(),
    ]);
    if (generation !== this.nativeRefreshGeneration || this.snapshot.book !== book) return;
    // Another book's queue (Android Auto): nothing here belongs to this book.
    if (!duringQueueChange && this.foreignBookId(queue)) { await this.adoptForeignQueue(queue); return; }
    const producingAudio = playingOverride ?? playing;
    const terminal = nativeState === "ended" || nativeState === "idle" || nativeState === "error";
    const buffering = nativeState === "buffering";
    const status: PlaybackStatus = terminal ? nativeState : buffering ? "buffering" : producingAudio ? "playing" : "paused";
    const intent: PlaybackIntent = terminal ? "stopped" : buffering ? this.snapshot.intent : producingAudio ? "playing" : "paused";
    this.emit({ activeTrackIndex, positionSeconds: progress.position, durationSeconds: progress.duration, status, intent });
    await this.checkpoint(reason, duringQueueChange);
  }
}

function normalizeEventState(state: unknown): PlaybackStatus {
  return (["idle", "loading", "ready", "buffering", "playing", "paused", "ended", "error"] as const)
    .find((candidate) => candidate === state) ?? "idle";
}

function valueOf(value: unknown | (() => unknown) | undefined): unknown {
  return typeof value === "function" ? value() : value ?? {};
}
