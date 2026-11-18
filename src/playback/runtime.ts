import { getStreams } from "../api";
import { embeddedChapters } from "../chapters";
import { followChapterTitles } from "../chapters/nowPlaying";
import { followBedtime } from "./bedtime";
import { followListening } from "../stats";
import { checkpointAudiobookProgress, continueListening } from "../library";
import { getSettings, SLEEP_FADE_SECONDS } from "../settings";
import { SessionRepository } from "../repositories/sessionRepository";
import { CheckpointWriter } from "./checkpointWriter";
import { buildPlayerConfig, buildRemoteCommands } from "./config";
import { nativePlayer } from "./nativePlayer";
import { getVerifiedBook } from "../downloads/localFiles";
import { PlaybackSession } from "./session";
import type { PlaybackBook } from "./types";

const sessions = new SessionRepository();
const library = {
  async get(id: string): Promise<PlaybackBook | null> {
    const value = await getVerifiedBook(id);
    if (!value || !Array.isArray(value.files)) return null;
    return value as PlaybackBook;
  },
  async recent(): Promise<PlaybackBook | null> {
    if (!getSettings().autoResume) return null;
    const items = await continueListening();
    const value = items[0] ? await getVerifiedBook(items[0].id) : null;
    return value && Array.isArray(value.files) ? value as PlaybackBook : null;
  },
};
const writer = new CheckpointWriter(sessions, { checkpoint: checkpointAudiobookProgress });

export const playbackSession = new PlaybackSession({
  player: nativePlayer,
  sessions,
  library,
  writer,
  playerConfig: buildPlayerConfig,
  commands: () => {
    const settings = getSettings();
    return buildRemoteCommands(settings.jumpForward, settings.jumpBack);
  },
  defaultRate: () => getSettings().speed || 1,
  smartRewind: () => getSettings().smartRewind !== false,
  resolveStreams: async (bookId) => {
    const result = await getStreams(bookId);
    if (!result?.ready || !Array.isArray(result.streams)) return [];
    return result.streams.map((stream: any) => ({
      title: stream.title, filename: stream.filename, url: stream.url,
      ...(stream.size > 0 ? { size: stream.size } : {}),
    }));
  },
});

// Android Auto's list of books (see carBrowse.ts).
export function setCarBrowseTree(categories: unknown[]): void {
  nativePlayer.setBrowseTree?.(categories);
}

// Chapter names on the lock screen / notification, for books that have them.
followChapterTitles({
  subscribe: (listener) => playbackSession.subscribe(listener),
  chaptersFor: embeddedChapters,
  updateMetadata: async (index, metadata) => { await nativePlayer.updateMetadata?.(index, metadata); },
});

// Optional bedtime sleep timer (Settings → Playback).
followBedtime({
  subscribe: (listener) => playbackSession.subscribe(listener),
  settings: getSettings,
  setSleep: (minutes, options) => playbackSession.setSleep(minutes, options),
  fadeOutSeconds: SLEEP_FADE_SECONDS,
});

// Listening time per day, for the Library's stats line.
followListening({ subscribe: (listener) => playbackSession.subscribe(listener) });
