import { isBookFinished } from "./progressModel";

export type NativeProgress = { position: number; duration: number };

export function buildProgressUpdate(progress: NativeProgress, trackIndex: number, itemCount: number) {
  return {
    position: Number.isFinite(progress.position) ? Math.max(0, progress.position) : 0,
    duration: Number.isFinite(progress.duration) ? Math.max(0, progress.duration) : 0,
    trackIndex: Math.max(0, trackIndex),
    finished: isBookFinished(trackIndex, itemCount, progress.position, progress.duration, false),
  };
}
