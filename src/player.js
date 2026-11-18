// Compatibility facade. PlaybackSession is the sole queue and persistence owner.
import { useEffect, useState } from "react";
import { buildRemoteCommands } from "./playback/config";
import { playbackSession, setCarBrowseTree } from "./playback/runtime";
import { buildBrowseTree } from "./playback/carBrowse";
import { listBooks } from "./library";
import { getVerifiedBook } from "./downloads/localFiles";
import { getSettings } from "./settings";

function legacySleep(sleep) {
  if (sleep.mode === "timer") return { mode: "timer", until: sleep.endsAt };
  if (sleep.mode === "end-of-track") return { mode: "eot", until: 0 };
  return { mode: "off", until: 0 };
}

export async function setupPlayer() { await playbackSession.initialize(); return true; }
export function getCurrentBook() { return playbackSession.getSnapshot().book; }
export async function loadBook(book, startTrack = 0, startPos = 0, options = {}) {
  if (book.downloaded) {
    book = await getVerifiedBook(book.id);
    if (!book?.files?.length) throw new Error("Offline files are missing. Open the book to stream or download it again.");
  }
  return playbackSession.loadBook(book, startTrack, startPos, options);
}
export async function play() { return playbackSession.play(); }

// Opening the book that is already loaded just resumes it: reloading would
// rebuffer the stream and jump back to the slightly older saved position.
// A book in an error state is reloaded, which is the fix for most errors.
export async function resumeOrLoad(book, fromStart = false) {
  const current = playbackSession.getSnapshot();
  if (!fromStart && current.book && current.book.id === book.id && current.status !== "error") {
    return playbackSession.play();
  }
  const p = fromStart ? {} : book.progress || {};
  return loadBook(book, p.trackIndex || 0, p.position || 0);
}
// Play from an exact spot (a bookmark): within the loaded book it's a seek,
// otherwise the book loads right there, without the usual resume rewind.
export async function playFrom(book, trackIndex = 0, position = 0) {
  const current = playbackSession.getSnapshot();
  if (current.book && current.book.id === book.id && current.status !== "error") {
    if ((current.activeTrackIndex || 0) !== trackIndex) await playbackSession.skipTo(trackIndex);
    await playbackSession.seekTo(position);
    return playbackSession.play();
  }
  return loadBook(book, trackIndex, position, { rewindOnResume: false });
}
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
// Android Auto's list of downloaded books (kept natively for when the app is closed).
export async function refreshCarBrowse() {
  setCarBrowseTree(buildBrowseTree(await listBooks()));
}
export function getSleep() { return legacySleep(playbackSession.getSnapshot().sleep); }
// options: { fadeOutSeconds, reason: "chapter" } — see PlaybackSession.setSleep.
export async function setSleep(value, options) {
  const target = value === "eot" ? "end-of-track" : value;
  return options ? playbackSession.setSleep(target, options) : playbackSession.setSleep(target);
}
export async function retryPlayback() { return playbackSession.retry(); }
// Close the current book (dismisses the mini player and notification).
export async function closeBook() { return playbackSession.unload(); }

// The live session snapshot: book, status (incl. "reconnecting"/"error"),
// error, sleep and rate. Re-renders whenever the session changes.
export function usePlaybackSnapshot() {
  const [snapshot, setSnapshot] = useState(() => playbackSession.getSnapshot());
  useEffect(() => playbackSession.subscribe(setSnapshot), []);
  return snapshot;
}
export function subscribeSleep(listener) {
  return playbackSession.subscribe((snapshot) => listener(legacySleep(snapshot.sleep)));
}
