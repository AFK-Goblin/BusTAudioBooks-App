import { STORAGE_SCHEMA_VERSION, type PlaybackSessionRecord } from "../domain/models";
import { buildMediaItems, parseMediaId } from "./config";
import type { CheckpointInput, LibraryProgressCheckpoint } from "./checkpointWriter";
import { isBookFinished, queueRevision } from "./progressModel";
import type { NativePlayerPort, PlaybackBook, PlaybackFile, PlaybackIntent, PlaybackSleep, PlaybackSnapshot, PlaybackStatus, Unsubscribe } from "./types";

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
};

const initialSnapshot: PlaybackSnapshot = {
  status: "idle", intent: "stopped", book: null, activeTrackIndex: 0,
  positionSeconds: 0, durationSeconds: 0, rate: 1, sleep: { mode: "off" },
};

export class PlaybackSession {
  private snapshot: PlaybackSnapshot = { ...initialSnapshot };
  private initializing: Promise<PlaybackSnapshot> | undefined;
  private readonly listeners = new Set<(snapshot: PlaybackSnapshot) => void>();
  private nativeUnsubscribes: Unsubscribe[] = [];
  private readonly now: () => number;
  private recovery: Promise<void> | undefined;
  private lastRecoveryAt = Number.NEGATIVE_INFINITY;
  private nativeRefreshGeneration = 0;

  constructor(private readonly deps: Dependencies) {
    this.now = deps.now ?? Date.now;
  }

  initialize(): Promise<PlaybackSnapshot> {
    if (!this.initializing) this.initializing = this.initializeOnce();
    return this.initializing;
  }

  getSnapshot(): PlaybackSnapshot { return { ...this.snapshot }; }

  subscribe(listener: (snapshot: PlaybackSnapshot) => void): Unsubscribe {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private emit(patch: Partial<PlaybackSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener(this.getSnapshot()));
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
          await this.adoptLive(book);
          return this.getSnapshot();
        }
      }
      await this.deps.player.replaceQueue([], 0);
    }
    await this.restorePersisted();
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
        const status = normalizeEventState(event?.state);
        const intent = status === "ended" || status === "idle" ? "stopped" : this.snapshot.intent;
        this.emit({ status: status === "ready" ? this.snapshot.status : status, intent });
        if (status === "ended" || status === "idle") void this.checkpoint("native-state");
      }),
      this.deps.player.subscribe("playing", (event) => {
        void this.refreshFromNative("native-playing", Boolean(event?.playing));
      }),
      this.deps.player.subscribe("transition", (event) => {
        void this.refreshFromNative("transition");
      }),
      this.deps.player.subscribe("error", (event) => { void this.handlePlaybackError(event); }),
      this.deps.player.subscribe("sleep", () => { void this.handleSleepTriggered(); }),
    ];
  }

  private async adoptLive(book: PlaybackBook): Promise<void> {
    const [activeTrackIndex, progress, nativeState, playing, rate, durable] = await Promise.all([
      this.deps.player.getActiveIndex(), this.deps.player.getProgress(), this.deps.player.getState(), this.deps.player.isPlaying(), this.deps.player.getRate(),
      this.deps.sessions.get().catch(() => null),
    ]);
    const buffering = nativeState === "buffering";
    const status: PlaybackStatus = buffering ? "buffering" : playing ? "playing" : nativeState === "ready" ? "paused" : nativeState;
    const durablePlaying = buffering && durable?.itemId === book.id && durable.intendedState === "playing";
    const intent: PlaybackIntent = playing || durablePlaying ? "playing" : status === "paused" ? "paused" : "stopped";
    this.emit({ book, activeTrackIndex, positionSeconds: progress.position, durationSeconds: progress.duration, status, intent, rate });
    await this.checkpoint("adopt-live");
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
    const remote = book.files.length > 0 && book.files.every((file) => !file.uri && /^https:\/\//i.test(file.url ?? ""));
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
    this.emit({ status: "loading", book: playableBook, activeTrackIndex: stored.activeTrackIndex, rate: stored.rate });
    await this.replaceAndWait(buildMediaItems(playableBook), stored.activeTrackIndex);
    if (stored.positionSeconds > 0) await this.deps.player.seekTo(position);
    await this.deps.player.setRate(stored.rate);
    this.emit({ status: "paused", intent: "paused", positionSeconds: position, durationSeconds: 0 });
    await this.checkpoint("cold-restore");
  }

  private async replaceAndWait(items: ReturnType<typeof buildMediaItems>, startIndex: number): Promise<void> {
    let unsubscribe: Unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ready = new Promise<void>((resolve) => {
      unsubscribe = this.deps.player.subscribe("state", (event) => {
        if (event?.state === "ready") resolve();
      });
      timer = setTimeout(resolve, 15_000);
    });
    await this.deps.player.replaceQueue(items, startIndex);
    await ready;
    if (timer) clearTimeout(timer);
    unsubscribe();
  }

  async loadBook(book: PlaybackBook, trackIndex = 0, position = 0, options: { play?: boolean; rewindOnResume?: boolean } = {}): Promise<void> {
    if (book.files.length === 0) throw new Error("No playable files");
    await this.initialize();
    const index = Math.min(Math.max(0, trackIndex), Math.max(0, book.files.length - 1));
    const target = Math.max(0, position - (options.rewindOnResume === false ? 0 : 5));
    await this.replaceAndWait(buildMediaItems(book), index);
    if (position > 0) await this.deps.player.seekTo(target);
    const rate = this.deps.defaultRate?.() ?? this.snapshot.rate;
    await this.deps.player.setRate(rate);
    this.emit({ book, activeTrackIndex: index, positionSeconds: target, rate, status: options.play === false ? "paused" : "playing", intent: options.play === false ? "paused" : "playing" });
    if (options.play !== false) await this.deps.player.play();
    await this.checkpoint("load-book");
  }

  async play(): Promise<void> { await this.deps.player.play(); this.emit({ status: "playing", intent: "playing" }); await this.checkpoint("play"); }
  async pause(): Promise<void> { await this.deps.player.pause(); this.emit({ status: "paused", intent: "paused" }); await this.refreshFromNative("pause"); }
  async stop(): Promise<void> { await this.deps.player.stop(); this.emit({ status: "idle", intent: "stopped" }); await this.refreshFromNative("stop"); }
  async seekTo(position: number): Promise<void> { await this.deps.player.seekTo(Math.max(0, position)); await this.refreshFromNative("seek"); }
  async seekBy(offset: number): Promise<void> { await this.deps.player.seekBy(offset); await this.refreshFromNative("seek"); }
  async skipTo(index: number): Promise<void> { await this.deps.player.skipTo(index); await this.refreshFromNative("skip"); }
  async setRate(rate: number): Promise<void> { await this.deps.player.setRate(rate); this.emit({ rate }); await this.checkpoint("rate"); }
  async configureCommands(commands: unknown): Promise<void> { await this.deps.player.configureCommands(commands); }
  async skipBy(offset: number): Promise<void> {
    const current = await this.deps.player.getActiveIndex();
    await this.skipTo(Math.max(0, current + offset));
  }
  async syncFromNative(reason: string): Promise<void> { await this.refreshFromNative(reason); }

  async setSleep(value: number | "end-of-track"): Promise<void> {
    await this.deps.player.cancelSleep();
    let sleep: PlaybackSleep = { mode: "off" };
    if (value === "end-of-track") {
      sleep = { mode: "end-of-track" };
      await this.deps.player.sleepAfterTrack(await this.deps.player.getActiveIndex());
    }
    else if (value > 0) {
      sleep = { mode: "timer", endsAt: this.now() + value * 60_000 };
      await this.deps.player.sleepAfterTime(value * 60);
    }
    this.emit({ sleep });
    await this.checkpoint("sleep");
  }

  async handlePlaybackError(_error: unknown): Promise<void> {
    if (this.recovery) return this.recovery;
    const book = this.snapshot.book;
    const resolver = this.deps.resolveStreams;
    const remote = book && book.files.length > 0 && book.files.every((file) => !file.uri && /^https:\/\//i.test(file.url ?? ""));
    if (!book || !resolver || !remote || this.now() - this.lastRecoveryAt < 30_000) {
      this.emit({ status: "error", error: { code: remote ? "stream-unavailable" : "media-unavailable", message: "Playback unavailable", retryable: Boolean(remote && resolver) } });
      await this.checkpoint("error");
      return;
    }
    this.lastRecoveryAt = this.now();
    this.recovery = this.recoverStream(book, resolver).finally(() => { this.recovery = undefined; });
    return this.recovery;
  }

  private async recoverStream(book: PlaybackBook, resolver: (bookId: string) => Promise<PlaybackFile[]>): Promise<void> {
    const [activeTrackIndex, progress, rate] = await Promise.all([
      this.deps.player.getActiveIndex(), this.deps.player.getProgress(), this.deps.player.getRate(),
    ]);
    const intent = this.snapshot.intent;
    this.emit({ status: "reconnecting" });
    try {
      const files = await resolver(book.id);
      if (files.length === 0) throw new Error("No streams");
      const fresh = { ...book, files };
      await this.replaceAndWait(buildMediaItems(fresh), activeTrackIndex);
      await this.deps.player.seekTo(progress.position);
      await this.deps.player.setRate(rate);
      this.emit({
        book: fresh, activeTrackIndex, positionSeconds: progress.position, durationSeconds: progress.duration,
        rate, status: intent === "playing" ? "playing" : "paused", intent,
      });
      if (intent === "playing") await this.deps.player.play();
      await this.checkpoint("recovery");
    } catch {
      this.emit({ status: "error", error: { code: "stream-recovery-failed", message: "Could not refresh this audiobook stream", retryable: true } });
      await this.checkpoint("recovery-failed");
    }
  }

  async handleSleepTriggered(): Promise<void> {
    this.emit({ sleep: { mode: "off" }, status: "paused", intent: "paused" });
    await this.refreshFromNative("sleep-triggered");
  }

  async checkpoint(_reason: string): Promise<void> {
    const book = this.snapshot.book;
    if (!book) return;
    const finished = isBookFinished(this.snapshot.activeTrackIndex, book.files.length, this.snapshot.positionSeconds, this.snapshot.durationSeconds, this.snapshot.status === "ended");
    const libraryProgress: LibraryProgressCheckpoint = {
      position: this.snapshot.positionSeconds, duration: this.snapshot.durationSeconds,
      trackIndex: this.snapshot.activeTrackIndex, finished,
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

  private async refreshFromNative(reason: string, playingOverride?: boolean): Promise<void> {
    if (!this.snapshot.book) return;
    const generation = ++this.nativeRefreshGeneration;
    const [activeTrackIndex, progress, nativeState, playing] = await Promise.all([
      this.deps.player.getActiveIndex(), this.deps.player.getProgress(), this.deps.player.getState(), this.deps.player.isPlaying(),
    ]);
    if (generation !== this.nativeRefreshGeneration) return;
    const producingAudio = playingOverride ?? playing;
    const terminal = nativeState === "ended" || nativeState === "idle" || nativeState === "error";
    const buffering = nativeState === "buffering";
    const status: PlaybackStatus = terminal ? nativeState : buffering ? "buffering" : producingAudio ? "playing" : "paused";
    const intent: PlaybackIntent = terminal ? "stopped" : buffering ? this.snapshot.intent : producingAudio ? "playing" : "paused";
    this.emit({ activeTrackIndex, positionSeconds: progress.position, durationSeconds: progress.duration, status, intent });
    await this.checkpoint(reason);
  }
}

function normalizeEventState(state: unknown): PlaybackStatus {
  return (["idle", "loading", "ready", "buffering", "playing", "paused", "ended", "error"] as const)
    .find((candidate) => candidate === state) ?? "idle";
}

function valueOf(value: unknown | (() => unknown) | undefined): unknown {
  return typeof value === "function" ? value() : value ?? {};
}
