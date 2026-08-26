// Compatibility facade. PlaybackSession is the sole queue and persistence owner.
import { buildRemoteCommands } from "./playback/config";
import { playbackSession } from "./playback/runtime";
import { getSettings } from "./settings";

function legacySleep(sleep) {
  if (sleep.mode === "timer") return { mode: "timer", until: sleep.endsAt };
  if (sleep.mode === "end-of-track") return { mode: "eot", until: 0 };
  return { mode: "off", until: 0 };
}

export async function setupPlayer() { await playbackSession.initialize(); return true; }
export function getCurrentBook() { return playbackSession.getSnapshot().book; }
export async function loadBook(book, startTrack = 0, startPos = 0, options = {}) {
  return playbackSession.loadBook(book, startTrack, startPos, options);
}
export async function play() { return playbackSession.play(); }
export async function pause() { return playbackSession.pause(); }
export async function stop() { return playbackSession.stop(); }
export async function seekTo(position) { return playbackSession.seekTo(position); }
export async function seekBy(offset) { return playbackSession.seekBy(offset); }
export async function skipToIndex(index) { return playbackSession.skipTo(index); }
export async function skipBy(offset) { return playbackSession.skipBy(offset); }
export async function checkpointPlayback(reason = "app-state") { return playbackSession.checkpoint(reason); }
export async function setRate(rate) { return playbackSession.setRate(rate); }
export async function getRate() { return playbackSession.getSnapshot().rate; }
export async function applyJumpIntervals() {
  const settings = getSettings();
  return playbackSession.configureCommands(buildRemoteCommands(settings.jumpForward, settings.jumpBack));
}
export function getSleep() { return legacySleep(playbackSession.getSnapshot().sleep); }
export async function setSleep(value) { return playbackSession.setSleep(value === "eot" ? "end-of-track" : value); }
export function subscribeSleep(listener) {
  return playbackSession.subscribe((snapshot) => listener(legacySleep(snapshot.sleep)));
}
