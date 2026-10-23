import type { PlaybackBook } from "./types";

export function queueRevision(book: Pick<PlaybackBook, "id" | "files">): string {
  const files = book.files.map((file, index) => [
    index,
    file.filename ?? "",
    file.title ?? "",
    file.uri ?? "",
  ]);
  return JSON.stringify([book.id, files]);
}

export function bookProgress(
  trackIndex: number,
  positionSeconds: number,
  durations: (number | undefined)[],
): { elapsedSeconds: number; totalSeconds?: number; remainingSeconds?: number; percentage?: number } {
  if (durations.length === 0) return { elapsedSeconds: Math.max(0, positionSeconds) };
  const index = Math.min(durations.length - 1, Math.max(0, Math.trunc(trackIndex)));
  const activeDuration = durations[index];
  const position = Math.max(0, Math.min(positionSeconds, activeDuration ?? positionSeconds));
  const completed = durations.slice(0, index).reduce<number>((sum, duration) => sum + (duration ?? 0), 0);
  const elapsedSeconds = completed + position;
  const allKnown = durations.every((duration) => typeof duration === "number" && Number.isFinite(duration) && duration >= 0);
  if (!allKnown) return { elapsedSeconds };
  const totalSeconds = durations.reduce<number>((sum, duration) => sum + (duration ?? 0), 0);
  const boundedElapsed = Math.min(elapsedSeconds, totalSeconds);
  return {
    elapsedSeconds: boundedElapsed,
    totalSeconds,
    remainingSeconds: Math.max(0, totalSeconds - boundedElapsed),
    percentage: totalSeconds > 0 ? (boundedElapsed / totalSeconds) * 100 : 0,
  };
}

export type BookEstimate = {
  elapsedSeconds: number;
  totalSeconds?: number;
  remainingSeconds?: number;
  percentage: number;
  // True when some part durations were inferred rather than measured.
  estimated: boolean;
};

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

// Whole-book progress for single- and multi-part books. Parts that have played
// report a real duration; the rest are estimated from file sizes (bitrate is
// near-constant within one book) or, without sizes, from the average known
// part. With nothing measured yet it falls back to a parts-based percentage.
export function estimateBookProgress(input: {
  trackIndex: number;
  positionSeconds: number;
  durationSeconds?: number;
  trackCount: number;
  trackDurations?: (number | null | undefined)[];
  sizes?: (number | null | undefined)[];
}): BookEstimate {
  const count = Math.max(1, Math.trunc(input.trackCount) || 1);
  const index = Math.min(count - 1, Math.max(0, Math.trunc(input.trackIndex) || 0));
  const position = Math.max(0, Number.isFinite(input.positionSeconds) ? input.positionSeconds : 0);
  const measured: (number | undefined)[] = Array.from({ length: count }, (_, i) => {
    const learned = input.trackDurations?.[i];
    if (i === index && positive(input.durationSeconds)) return input.durationSeconds;
    return positive(learned) ? learned : undefined;
  });
  const knownIndexes = measured.flatMap((d, i) => (d === undefined ? [] : [i]));
  if (knownIndexes.length === 0) {
    return { elapsedSeconds: position, percentage: Math.min(100, (index / count) * 100), estimated: true };
  }
  const sizes = input.sizes ?? [];
  const sizedKnown = knownIndexes.filter((i) => positive(sizes[i]));
  const secondsPerByte = sizedKnown.length
    ? sizedKnown.reduce((sum, i) => sum + measured[i]!, 0) / sizedKnown.reduce((sum, i) => sum + (sizes[i] as number), 0)
    : undefined;
  const average = knownIndexes.reduce((sum, i) => sum + measured[i]!, 0) / knownIndexes.length;
  let estimated = false;
  const durations = measured.map((d, i) => {
    if (d !== undefined) return d;
    estimated = true;
    const size = sizes[i];
    return secondsPerByte !== undefined && positive(size) ? size * secondsPerByte : average;
  });
  const totalSeconds = durations.reduce((sum, d) => sum + d, 0);
  const completed = durations.slice(0, index).reduce((sum, d) => sum + d, 0);
  const elapsedSeconds = Math.min(totalSeconds, completed + Math.min(position, durations[index]!));
  return {
    elapsedSeconds,
    totalSeconds,
    remainingSeconds: Math.max(0, totalSeconds - elapsedSeconds),
    percentage: totalSeconds > 0 ? Math.min(100, (elapsedSeconds / totalSeconds) * 100) : 0,
    estimated,
  };
}

// Library-entry convenience used by the Home, Library and Player screens.
export function audiobookEstimate(entry: {
  files?: { size?: number }[];
  progress?: { trackIndex?: number; position?: number; duration?: number; trackDurations?: (number | null)[] };
} | null | undefined, live?: { trackIndex: number; positionSeconds: number; durationSeconds: number }): BookEstimate {
  const progress = entry?.progress ?? {};
  const files = entry?.files ?? [];
  const trackCount = Math.max(files.length, progress.trackDurations?.length ?? 0, 1);
  return estimateBookProgress({
    trackIndex: live?.trackIndex ?? progress.trackIndex ?? 0,
    positionSeconds: live?.positionSeconds ?? progress.position ?? 0,
    durationSeconds: live?.durationSeconds ?? progress.duration ?? 0,
    trackCount,
    trackDurations: progress.trackDurations ?? [],
    sizes: files.map((file) => file?.size),
  });
}

export function isBookFinished(
  trackIndex: number,
  trackCount: number,
  positionSeconds: number,
  durationSeconds: number,
  nativeEnded: boolean,
): boolean {
  if (trackCount <= 0 || trackIndex !== trackCount - 1) return false;
  if (nativeEnded) return true;
  return durationSeconds > 0 && positionSeconds >= Math.max(0, durationSeconds - 15);
}
