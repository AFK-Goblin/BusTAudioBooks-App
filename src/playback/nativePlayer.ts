import TrackPlayer, { Event } from "@rntp/player";
import type { NativeMediaItem, NativePlayerPort, PlaybackEvent, PlaybackStatus } from "./types";

type PlayerDependency = Record<string, (...args: any[]) => any>;
type EventMap = Record<PlaybackEvent, unknown>;

const defaultEvents: EventMap = {
  progress: Event.PlaybackProgressUpdated,
  state: Event.PlaybackStateChanged,
  playing: Event.IsPlayingChanged,
  transition: Event.MediaItemTransition,
  error: Event.PlaybackError,
  sleep: Event.SleepTimerTriggered,
};

// setupPlayer only STARTS connecting to the Android playback service
// (MediaController.buildAsync) and returns at once. Until that connection
// exists, the player silently drops every command — so the first book opened
// after the app had been closed (service not running yet) was never loaded,
// and the wait for "ready" timed out, while a retry seconds later worked.
// Unconnected, getProgress() reports a duration of exactly 0 with an idle,
// empty player; once connected, Media3 reports the real length or its
// negative "unknown" sentinel (C.TIME_UNSET), or the queue/state shows life.
const CONNECT_TIMEOUT_MS = 5_000;
const CONNECT_POLL_MS = 50;

async function isConnected(player: PlayerDependency): Promise<boolean> {
  if (typeof player.getProgress !== "function") return true; // can't tell: don't wait
  try {
    const progress = await player.getProgress();
    if (progress && typeof progress.duration === "number" && progress.duration !== 0) return true;
    const queue = await player.getQueue?.();
    if (Array.isArray(queue) && queue.length > 0) return true;
    const state = await player.getPlaybackState?.();
    return state != null && state !== "idle";
  } catch {
    return false;
  }
}

export async function waitUntilConnected(player: PlayerDependency, timeoutMs = CONNECT_TIMEOUT_MS, pollMs = CONNECT_POLL_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await isConnected(player)) return true;
    if (Date.now() >= deadline) return false; // carry on; replaceAndWait re-sends if needed
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

function normalizedState(state: unknown): PlaybackStatus {
  return (["idle", "loading", "ready", "buffering", "playing", "paused", "ended", "error"] as const)
    .find((candidate) => candidate === state) ?? "idle";
}

export function createNativePlayerPort(
  player: PlayerDependency = TrackPlayer as unknown as PlayerDependency,
  events: EventMap = defaultEvents,
): NativePlayerPort {
  return {
    async setup(config) {
      await player.setupPlayer?.(config);
      await waitUntilConnected(player);
    },
    async configureCommands(commands) { await player.setCommands?.(commands); },
    async getQueue() { return await player.getQueue?.() ?? []; },
    async getActiveIndex() { return await player.getActiveMediaItemIndex?.() ?? 0; },
    async getProgress() { return await player.getProgress?.() ?? { position: 0, duration: 0 }; },
    async getState() { return normalizedState(await player.getPlaybackState?.()); },
    async isPlaying() { return Boolean(await player.isPlaying?.()); },
    async getRate() { return await player.getPlaybackSpeed?.() ?? 1; },
    async replaceQueue(items: NativeMediaItem[], startIndex: number) { await player.setMediaItems?.(items, startIndex); },
    async play() { await player.play?.(); }, async pause() { await player.pause?.(); }, async stop() { await player.stop?.(); },
    async seekTo(position) { await player.seekTo?.(position); }, async seekBy(offset) { await player.seekBy?.(offset); },
    async skipTo(index) { await player.skipToIndex?.(index); }, async setRate(rate) { await player.setPlaybackSpeed?.(rate); },
    async sleepAfterTime(seconds, fadeOutSeconds) {
      // Native fades the volume over the final seconds, pauses, then restores it.
      if (fadeOutSeconds && fadeOutSeconds > 0) await player.sleepAfterTime?.(seconds, { fadeOutSeconds });
      else await player.sleepAfterTime?.(seconds);
    },
    async sleepAfterTrack(index) { await player.sleepAfterMediaItemAtIndex?.(index); },
    async cancelSleep() { await player.cancelSleepTimer?.(); },
    async getSleepTimer() {
      const timer = await player.getSleepTimer?.();
      if (timer?.type === "time" && Number.isFinite(timer.remainingSeconds)) {
        return { type: "time" as const, remainingSeconds: timer.remainingSeconds, ...(timer.fadeOutSeconds > 0 ? { fadeOutSeconds: timer.fadeOutSeconds } : {}) };
      }
      if (timer?.type === "mediaItem" && Number.isInteger(timer.index)) return { type: "mediaItem" as const, index: timer.index };
      return null;
    },
    // Native keeps the item's URI, so Media3 swaps the metadata in place
    // without re-preparing or interrupting playback.
    async updateMetadata(index, metadata) { await player.updateMetadata?.(index, metadata); },
    setBrowseTree(categories) { player.setBrowseTree?.(categories); },
    subscribe(event, listener) {
      const subscription = player.addEventListener?.(events[event], listener);
      let active = true;
      return () => { if (active) subscription?.remove(); active = false; };
    },
  };
}

export const nativePlayer = createNativePlayerPort();
