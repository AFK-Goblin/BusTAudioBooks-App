export type PlaybackStatus = "idle" | "loading" | "ready" | "buffering" | "playing" | "paused" | "reconnecting" | "ended" | "error";
export type PlaybackIntent = "playing" | "paused" | "stopped";
export type PlaybackSleep = { mode: "off" } | { mode: "timer"; endsAt: number } | { mode: "end-of-track" };
export type PlaybackEvent = "progress" | "state" | "playing" | "transition" | "error" | "sleep";
export type Unsubscribe = () => void;

export type PlaybackFile = { title?: string; filename?: string; url?: string; uri?: string; duration?: number };
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
  sleepAfterTime(seconds: number): Promise<void>; sleepAfterTrack(index: number): Promise<void>; cancelSleep(): Promise<void>;
  subscribe(event: PlaybackEvent, listener: (payload: any) => void): Unsubscribe;
}
