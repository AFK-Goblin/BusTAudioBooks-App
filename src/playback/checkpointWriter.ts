import type { PlaybackSessionRecord } from "../domain/models";

export type LibraryProgressCheckpoint = {
  position: number;
  duration: number;
  trackIndex: number;
  finished: boolean;
  trackDurations?: number[];
};

export type CheckpointInput = {
  session: PlaybackSessionRecord;
  libraryProgress: LibraryProgressCheckpoint;
};

type SessionStore = { checkpoint(session: PlaybackSessionRecord): Promise<void> };
type LibraryStore = { checkpoint(bookId: string, progress: LibraryProgressCheckpoint): Promise<void> };

function durableKey(input: CheckpointInput): string {
  const { checkpointedAt: _checkpointedAt, ...session } = input.session;
  return JSON.stringify({ session, libraryProgress: input.libraryProgress });
}

export class CheckpointWriter {
  private pending: CheckpointInput | undefined;
  private draining: Promise<void> | undefined;
  private lastWrittenKey: string | undefined;

  constructor(
    private readonly sessions: SessionStore,
    private readonly library: LibraryStore,
    private readonly onError: (error: Error) => void = () => {},
  ) {}

  enqueue(input: CheckpointInput): Promise<void> {
    const key = durableKey(input);
    if (key === this.lastWrittenKey || (this.pending && key === durableKey(this.pending))) {
      return this.draining ?? Promise.resolve();
    }
    this.pending = input;
    if (!this.draining) {
      this.draining = this.drain().finally(() => { this.draining = undefined; });
    }
    return this.draining;
  }

  async flush(): Promise<void> {
    await this.draining;
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const input = this.pending;
      this.pending = undefined;
      const key = durableKey(input);
      if (key === this.lastWrittenKey) continue;
      try {
        await this.sessions.checkpoint(input.session);
        await this.library.checkpoint(input.session.itemId, input.libraryProgress);
        this.lastWrittenKey = key;
      } catch (error) {
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}
