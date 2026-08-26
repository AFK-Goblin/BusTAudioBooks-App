type Subscription = { remove(): void };
type PlayerLike = {
  addEventListener(event: any, listener: (event: { state: string }) => void): Subscription;
  setMediaItems(items: any[], startIndex: number): void;
  seekTo(position: number): void;
};

export async function loadMediaItemsAtPosition(
  player: PlayerLike,
  playbackStateEvent: any,
  items: any[],
  startIndex: number,
  startPosition: number,
  rewindSeconds = 0,
) {
  if (!(startPosition > 0)) {
    player.setMediaItems(items, startIndex);
    return;
  }

  let subscription: Subscription | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = new Promise<void>((resolve) => {
    subscription = player.addEventListener(playbackStateEvent, ({ state }) => {
      if (state === "ready") resolve();
    });
    timer = setTimeout(resolve, 15_000);
  });
  player.setMediaItems(items, startIndex);
  await ready;
  if (timer) clearTimeout(timer);
  subscription?.remove();
  player.seekTo(Math.max(0, startPosition - Math.max(0, rewindSeconds)));
}
