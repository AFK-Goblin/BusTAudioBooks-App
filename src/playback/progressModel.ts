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
