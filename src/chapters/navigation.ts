import type { Chapter } from "./mp4";

// Positions within half a second of a chapter start count as inside it, so a
// seek that lands a hair early still shows the chapter it was aimed at.
const START_TOLERANCE = 0.5;
// "Previous" restarts the current chapter unless you're within its first
// seconds, like the previous-track button on a music player.
const RESTART_WINDOW = 3;

export function chapterIndexAt(chapters: Chapter[], position: number): number {
  let index = 0;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i]!.start <= position + START_TOLERANCE) index = i;
    else break;
  }
  return index;
}

export function chapterEnd(chapters: Chapter[], index: number, durationSeconds: number): number {
  return chapters[index + 1]?.start ?? durationSeconds;
}

// Seek target for "previous chapter", or null to fall through to the previous part.
export function previousChapterTarget(chapters: Chapter[], position: number): number | null {
  if (chapters.length === 0) return null;
  const index = chapterIndexAt(chapters, position);
  const start = chapters[index]!.start;
  if (position - start > RESTART_WINDOW) return start;
  return index > 0 ? chapters[index - 1]!.start : null;
}

// Seek target for "next chapter", or null to fall through to the next part.
export function nextChapterTarget(chapters: Chapter[], position: number): number | null {
  if (chapters.length === 0) return null;
  return chapters[chapterIndexAt(chapters, position) + 1]?.start ?? null;
}

// Where the previous/next buttons go: a chapter start within this part, or
// the start of another part.
export type Step = { trackIndex: number; position: number };

export function previousStep(chapters: Chapter[] | null, position: number, trackIndex: number): Step {
  if (chapters) {
    const target = previousChapterTarget(chapters, position);
    if (target != null) return { trackIndex, position: target };
  }
  if (!chapters && position > RESTART_WINDOW) return { trackIndex, position: 0 };
  if (trackIndex > 0) return { trackIndex: trackIndex - 1, position: 0 };
  return { trackIndex, position: 0 };
}

// null at the end of the book.
export function nextStep(chapters: Chapter[] | null, position: number, trackIndex: number, trackCount: number): Step | null {
  if (chapters) {
    const target = nextChapterTarget(chapters, position);
    if (target != null) return { trackIndex, position: target };
  }
  return trackIndex < trackCount - 1 ? { trackIndex: trackIndex + 1, position: 0 } : null;
}
