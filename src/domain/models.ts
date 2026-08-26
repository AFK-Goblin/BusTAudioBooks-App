export const STORAGE_SCHEMA_VERSION = 2 as const;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: string[] };

export type MediaType = "audiobook" | "comic";
export type DownloadState =
  | "queued"
  | "resolving"
  | "waiting-network"
  | "downloading"
  | "paused"
  | "verifying"
  | "complete"
  | "failed"
  | "cancelled";

export interface AudiobookProgress {
  trackIndex: number;
  positionSeconds: number;
  trackDurations?: number[];
  completedDurationSeconds?: number;
  totalDurationSeconds?: number;
  finished: boolean;
  lastPlayedAt: number;
}

export interface ComicProgress {
  chapterId?: string;
  chapterNumber?: string;
  page: number;
  totalPages: number;
  finished: boolean;
  lastReadAt: number;
}

export interface Bookmark {
  id: string;
  trackIndex: number;
  positionSeconds: number;
  createdAt: number;
  note?: string;
}

export interface LocalResource {
  id: string;
  mediaIndex: number;
  uri: string;
  filename?: string;
  byteSize?: number;
  verification: "unknown" | "verified" | "failed";
  extractedPages?: string[];
}

export interface LibraryItem {
  schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  id: string;
  mediaType: MediaType;
  title: string;
  authors: string[];
  narrators?: string[];
  series?: { name: string; position?: string };
  artworkUrl?: string;
  description?: string;
  addedAt: number;
  updatedAt: number;
  lastInteractedAt?: number;
  progress?: AudiobookProgress | ComicProgress;
  bookmarks: Bookmark[];
  localResources: LocalResource[];
  source?: Record<string, unknown>;
}

export interface PlaybackSessionRecord {
  schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  itemId: string;
  queueRevision: string;
  activeTrackIndex: number;
  positionSeconds: number;
  rate: number;
  intendedState: "playing" | "paused" | "stopped";
  sleep?: { mode: "timer"; endsAt: number } | { mode: "end-of-track" };
  checkpointedAt: number;
  recovery?: { attemptedAt: number; reason: string };
}

export interface SettingsRecord {
  schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  speed: number;
  jumpBack: number;
  jumpForward: number;
  wifiOnly: boolean;
  autoResume: boolean;
  autoDeleteFinished: boolean;
  dataSaver: boolean;
  comicsEnabled: boolean;
}

export interface DownloadJobRecord {
  schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  id: string;
  itemId: string;
  kind: MediaType;
  state: DownloadState;
  sources: Array<{ title?: string; url?: string; filename?: string }>;
  destinations: string[];
  bytesDownloaded: number;
  bytesTotal: number;
  wifiOnly: boolean;
  retryCount: number;
  createdAt: number;
  updatedAt: number;
}
