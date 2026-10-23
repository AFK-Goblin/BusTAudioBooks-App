// Bedtime sleep timer: listening that starts late at night arms a sleep timer
// by itself, so falling asleep mid-chapter doesn't play the book out. Runs
// wherever the playback session runs (UI and background service alike), so
// resuming from the lock screen or a headset counts too.
import type { PlaybackSnapshot, SleepOptions } from "./types";

export const BEDTIME_ENDS_AT_HOUR = 6;

// True between startHour and 06:00 (wrapping midnight, e.g. 22:00–06:00).
export function inBedtime(date: Date, startHour: number, endHour = BEDTIME_ENDS_AT_HOUR): boolean {
  const hour = date.getHours();
  return startHour > endHour ? hour >= startHour || hour < endHour : hour >= startHour && hour < endHour;
}

type BedtimeSettings = { bedtimeTimer?: boolean; bedtimeStart?: number; bedtimeMinutes?: number; sleepFade?: boolean };
type Dependencies = {
  subscribe(listener: (snapshot: PlaybackSnapshot) => void): () => void;
  settings(): BedtimeSettings;
  setSleep(minutes: number, options: SleepOptions): Promise<void>;
  now?: () => number;
  fadeOutSeconds: number;
};

export function followBedtime(deps: Dependencies): () => void {
  let wasPlaying = false;
  return deps.subscribe((snapshot) => {
    const playing = snapshot.intent === "playing";
    const started = playing && !wasPlaying;
    wasPlaying = playing;
    // Only when listening starts, and never over a timer already running: a
    // timer the listener turned off stays off until the next start.
    if (!started || !snapshot.book || snapshot.sleep.mode !== "off") return;
    const settings = deps.settings();
    if (!settings.bedtimeTimer) return;
    if (!inBedtime(new Date(deps.now ? deps.now() : Date.now()), settings.bedtimeStart ?? 22)) return;
    void deps.setSleep(settings.bedtimeMinutes ?? 30, settings.sleepFade === false ? {} : { fadeOutSeconds: deps.fadeOutSeconds })
      .catch(() => {});
  });
}
