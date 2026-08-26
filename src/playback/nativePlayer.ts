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

function normalizedState(state: unknown): PlaybackStatus {
  return (["idle", "loading", "ready", "buffering", "playing", "paused", "ended", "error"] as const)
    .find((candidate) => candidate === state) ?? "idle";
}

export function createNativePlayerPort(
  player: PlayerDependency = TrackPlayer as unknown as PlayerDependency,
  events: EventMap = defaultEvents,
): NativePlayerPort {
  return {
    async setup(config) { await player.setupPlayer?.(config); },
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
    async sleepAfterTime(seconds) { await player.sleepAfterTime?.(seconds); },
    async sleepAfterTrack(index) { await player.sleepAfterMediaItemAtIndex?.(index); },
    async cancelSleep() { await player.cancelSleepTimer?.(); },
    subscribe(event, listener) {
      const subscription = player.addEventListener?.(events[event], listener);
      let active = true;
      return () => { if (active) subscription?.remove(); active = false; };
    },
  };
}

export const nativePlayer = createNativePlayerPort();
