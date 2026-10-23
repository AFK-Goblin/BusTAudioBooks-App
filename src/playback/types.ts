export type PlaybackStatus = "idle" | "loading" | "ready" | "buffering" | "playing" | "paused" | "reconnecting" | "ended" | "error";
export type PlaybackIntent = "playing" | "paused" | "stopped";
export type PlaybackSleep =
  | { mode: "off" }
  // reason "chapter": a timer aimed at the end of an embedded chapter.
  | { mode: "timer"; endsAt: number; fadeOutSeconds?: number; reason?: "chapter" }
  | { mode: "end-of-track" };
export type SleepOptions = { fadeOutSeconds?: number; reason?: "chapter" };
export type NativeSleepTimer = { type: "time"; remainingSeconds: number; fadeOutSeconds?: number } | { type: "mediaItem"; index: number };
export type PlaybackEvent = "progress" | "state" | "playing" | "transition" | "error" | "sleep";
export type Unsubscribe = () => void;

export type PlaybackFile = { title?: string; filename?: string; url?: string; uri?: string; duration?: number; size?: number };
export type PlaybackBook = { id: string; title: string; author?: string; poster?: string; files: PlaybackFile[] };
export type NativeMediaItem = { mediaId: string; url?: string; title?: string; artist?: string; albumTitle?: string; artworkUrl?: string; extras?: Record<string, unknown> };
export type NativeProgress = { position: number; duration: number };

export interface PlaybackErrorInfo { code: string; message: string; retryable: boolean }
export interface PlaybackSnapshot {
  status: PlaybackStatus;
  intent: PlaybackIntent;
  book: PlaybackBook | null;
  activeTrackIndex: number;
  positionSeconds: number;
  durationSeconds: number;
  rate: number;
  sleep: PlaybackSleep;
  error?: PlaybackErrorInfo;
}

export interface NativePlayerPort {
  setup(config: unknown): Promise<void>;
  configureCommands(commands: unknown): Promise<void>;
  getQueue(): Promise<NativeMediaItem[]>;
  getActiveIndex(): Promise<number>;
  getProgress(): Promise<NativeProgress>;
  getState(): Promise<PlaybackStatus>;
  isPlaying(): Promise<boolean>;
  getRate(): Promise<number>;
  replaceQueue(items: NativeMediaItem[], startIndex: number): Promise<void>;
  play(): Promise<void>; pause(): Promise<void>; stop(): Promise<void>;
  seekTo(position: number): Promise<void>; seekBy(offset: number): Promise<void>;
  skipTo(index: number): Promise<void>; setRate(rate: number): Promise<void>;
  sleepAfterTime(seconds: number, fadeOutSeconds?: number): Promise<void>; sleepAfterTrack(index: number): Promise<void>; cancelSleep(): Promise<void>;
  getSleepTimer?(): Promise<NativeSleepTimer | null>;
  // Retitles a queued item in place (notification, lock screen, car displays).
  updateMetadata?(index: number, metadata: { title?: string; artist?: string; albumTitle?: string }): Promise<void>;
  // What Android Auto lists (kept natively, so it works with the app closed).
  setBrowseTree?(categories: unknown[]): void;
  subscribe(event: PlaybackEvent, listener: (payload: any) => void): Unsubscribe;
}
