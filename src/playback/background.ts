type BackgroundSession = {
  initialize(): Promise<unknown>;
  play?(): Promise<void>; pause?(): Promise<void>; stop?(): Promise<void>;
  skipBy?(offset: number): Promise<void>; seekBy?(offset: number): Promise<void>; seekTo?(position: number): Promise<void>;
  syncFromNative?(reason: string): Promise<void>;
  handleSleepTriggered?(): Promise<void>;
};

type BackgroundEvents = {
  progress: unknown; play: unknown; pause: unknown; stop: unknown; next: unknown; previous: unknown;
  forward: unknown; backward: unknown; seek: unknown; noisy: unknown;
  playing: unknown;
  sleep: unknown;
};

export async function handleBackgroundEvent(
  event: { type: unknown; interval?: number; position?: number },
  session: BackgroundSession,
  events: BackgroundEvents,
): Promise<void> {
  await session.initialize();
  switch (event.type) {
    case events.progress: await session.syncFromNative?.("background-progress"); break;
    case events.playing: await session.syncFromNative?.("background-playing"); break;
    case events.sleep: await session.handleSleepTriggered?.(); break;
    case events.play: await session.play?.(); break;
    case events.pause: await session.pause?.(); break;
    case events.stop: await session.stop?.(); break;
    case events.next: await session.skipBy?.(1); break;
    case events.previous: await session.skipBy?.(-1); break;
    case events.forward: await session.seekBy?.(event.interval ?? 30); break;
    case events.backward: await session.seekBy?.(-(event.interval ?? 15)); break;
    case events.seek: await session.seekTo?.(Math.max(0, event.position ?? 0)); break;
    case events.noisy: await session.pause?.(); break;
  }
}
