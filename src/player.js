// src/player.js — track-player setup + loading a book's files as a queue,
// plus the sleep timer (lives here, not in a screen, so it keeps working when
// the player screen unmounts or the app is backgrounded).
import TrackPlayer, {
  Capability,
  AppKilledPlaybackBehavior,
  Event,
} from "react-native-track-player";
import { getSettings } from "./settings";
import { getStreams } from "./api";
import { upsertBook } from "./library";

let ready = false;
let currentBook = null;
let lastRecovery = 0; // guards against a recovery loop when fresh URLs also fail

export function setCurrentBook(b) {
  currentBook = b;
}
export function getCurrentBook() {
  return currentBook;
}

// ---- Sleep timer -----------------------------------------------------------
// mode: "off" | "timer" (until = epoch ms) | "eot" (pause at end of chapter)
let sleep = { mode: "off", until: 0 };
const sleepListeners = new Set();

function emitSleep() {
  sleepListeners.forEach((fn) => fn({ ...sleep }));
}

export function getSleep() {
  return { ...sleep };
}

// setSleep(0) → off; setSleep(30) → 30 minutes; setSleep("eot") → end of chapter.
export function setSleep(value) {
  if (value === "eot") sleep = { mode: "eot", until: 0 };
  else if (value > 0) sleep = { mode: "timer", until: Date.now() + value * 60 * 1000 };
  else sleep = { mode: "off", until: 0 };
  emitSleep();
}

export function subscribeSleep(fn) {
  sleepListeners.add(fn);
  fn({ ...sleep });
  return () => sleepListeners.delete(fn);
}

async function sleepPause() {
  sleep = { mode: "off", until: 0 };
  emitSleep();
  try {
    await TrackPlayer.pause();
  } catch (_) {}
}

// ---- Player setup ----------------------------------------------------------
export async function applyJumpIntervals() {
  const s = getSettings();
  await TrackPlayer.updateOptions({
    android: {
      appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
    },
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SeekTo,
      Capability.JumpForward,
      Capability.JumpBackward,
      Capability.Stop,
    ],
    compactCapabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.JumpForward,
      Capability.JumpBackward,
    ],
    progressUpdateEventInterval: 5,
    forwardJumpInterval: s.jumpForward,
    backwardJumpInterval: s.jumpBack,
  });
}

export async function setupPlayer() {
  if (ready) return true;
  try {
    // Throws if not yet set up.
    await TrackPlayer.getActiveTrackIndex();
    ready = true;
  } catch (_) {
    await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
    ready = true;
  }
  await applyJumpIntervals();

  // Sleep timer hooks. Progress events fire every 5s while playing (even in
  // the background service), which is what makes the timer reliable there.
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, () => {
    if (sleep.mode === "timer" && Date.now() >= sleep.until) sleepPause();
  });
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (e) => {
    if (sleep.mode === "eot" && e && e.lastTrack != null) sleepPause();
  });
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
    if (sleep.mode !== "off") sleepPause();
  });

  // TorBox stream links expire; when playback of a streamed book errors,
  // silently re-resolve fresh URLs and pick up where we were.
  TrackPlayer.addEventListener(Event.PlaybackError, () => {
    recoverStreams();
  });
  return true;
}

async function recoverStreams() {
  const book = currentBook;
  if (!book) return;
  // Only streamed books: local (file://) failures aren't fixed by re-resolving.
  const files = book.files || [];
  const streamed = files.length > 0 && files.every((f) => !f.uri && /^https:\/\//i.test(f.url || ""));
  if (!streamed) return;
  if (Date.now() - lastRecovery < 30000) return;
  lastRecovery = Date.now();
  try {
    let idx = 0;
    let pos = 0;
    try { idx = (await TrackPlayer.getActiveTrackIndex()) || 0; } catch (_) {}
    try { pos = (await TrackPlayer.getProgress()).position || 0; } catch (_) {}
    const r = await getStreams(book.id);
    if (!r || !r.ready || !r.streams || r.streams.length === 0) return;
    const freshFiles = r.streams.map((s) => ({ title: s.title, url: s.url, filename: s.filename }));
    const fresh = { ...book, files: freshFiles };
    await upsertBook(fresh); // cache the new URLs for Continue Listening too
    await loadBook(fresh, idx, pos);
  } catch (_) {
    /* server unreachable — the user can retry from the book screen */
  }
}

// book: { id, title, author, poster, files: [{ title, url?, uri? }] }
export async function loadBook(book, startTrack = 0, startPos = 0, { play = true } = {}) {
  await setupPlayer();
  await TrackPlayer.reset();
  const tracks = (book.files || []).map((f, i) => ({
    id: String(i),
    url: f.uri || f.url,
    title: f.title || `${book.title} — Part ${i + 1}`,
    artist: book.author || "BusTAudio",
    album: book.title,
    artwork: book.poster || undefined,
  }));
  if (tracks.length === 0) throw new Error("No playable files");
  await TrackPlayer.add(tracks);
  if (startTrack > 0 && startTrack < tracks.length) await TrackPlayer.skip(startTrack);
  if (startPos > 0) await TrackPlayer.seekTo(startPos);
  await TrackPlayer.setRate(getSettings().speed || 1);
  if (play) await TrackPlayer.play();
  setCurrentBook(book);
}

export async function setRate(rate) {
  await TrackPlayer.setRate(rate);
}

export async function getRate() {
  try {
    return await TrackPlayer.getRate();
  } catch (_) {
    return getSettings().speed || 1;
  }
}
