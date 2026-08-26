import { getStreams } from "../api";
import { checkpointAudiobookProgress, continueListening, getBook } from "../library";
import { getSettings } from "../settings";
import { SessionRepository } from "../repositories/sessionRepository";
import { CheckpointWriter } from "./checkpointWriter";
import { buildPlayerConfig, buildRemoteCommands } from "./config";
import { nativePlayer } from "./nativePlayer";
import { PlaybackSession } from "./session";
import type { PlaybackBook } from "./types";

const sessions = new SessionRepository();
const library = {
  async get(id: string): Promise<PlaybackBook | null> {
    const value = await getBook(id);
    if (!value || !Array.isArray(value.files)) return null;
    return value as PlaybackBook;
  },
  async recent(): Promise<PlaybackBook | null> {
    if (!getSettings().autoResume) return null;
    const items = await continueListening();
    const value = items[0];
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
  resolveStreams: async (bookId) => {
    const result = await getStreams(bookId);
    if (!result?.ready || !Array.isArray(result.streams)) return [];
    return result.streams.map((stream: any) => ({ title: stream.title, filename: stream.filename, url: stream.url }));
  },
});
