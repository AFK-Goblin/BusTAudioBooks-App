jest.mock("@rntp/player", () => ({
  __esModule: true,
  default: {},
  Event: {
    PlaybackProgressUpdated: "native-progress",
    PlaybackStateChanged: "native-state",
    IsPlayingChanged: "native-playing",
    MediaItemTransition: "native-transition",
    PlaybackError: "native-error",
    SleepTimerTriggered: "native-sleep",
  },
}));

// eslint-disable-next-line import/first
import { createNativePlayerPort, waitUntilConnected } from "../nativePlayer";

function harness() {
  const remove = jest.fn();
  const player = {
    setupPlayer: jest.fn(), setCommands: jest.fn(), getQueue: jest.fn(() => [{ mediaId: "book:0" }]),
    getActiveMediaItemIndex: jest.fn(() => 0), getProgress: jest.fn(async () => ({ position: 12, duration: 30 })),
    getPlaybackState: jest.fn(() => "ready"), isPlaying: jest.fn(() => true), getPlaybackSpeed: jest.fn(() => 1.25),
    setMediaItems: jest.fn(), play: jest.fn(), pause: jest.fn(), stop: jest.fn(), seekTo: jest.fn(),
    seekBy: jest.fn(), skipToIndex: jest.fn(), setPlaybackSpeed: jest.fn(), sleepAfterTime: jest.fn(),
    sleepAfterMediaItemAtIndex: jest.fn(), cancelSleepTimer: jest.fn(),
    addEventListener: jest.fn(() => ({ remove })), clear: jest.fn(),
  };
  const events = { progress: "progress-event", state: "state-event", playing: "playing-event", transition: "transition-event", error: "error-event", sleep: "sleep-event" };
  return { player, events, remove, port: createNativePlayerPort(player, events) };
}

test("translates native player reads and commands", async () => {
  const { port, player } = harness();
  await port.setup({ contentType: "speech" });
  await port.configureCommands({ capabilities: ["playPause"] });
  expect(await port.getQueue()).toEqual([{ mediaId: "book:0" }]);
  expect(await port.getProgress()).toEqual({ position: 12, duration: 30 });
  expect(await port.getState()).toBe("ready");
  expect(await port.isPlaying()).toBe(true);
  expect(await port.getRate()).toBe(1.25);
  await port.replaceQueue([{ mediaId: "book:1" }], 1);
  await port.seekTo(20); await port.seekBy(-5); await port.skipTo(1); await port.setRate(1.5);
  expect(player.setMediaItems).toHaveBeenCalledWith([{ mediaId: "book:1" }], 1);
  expect(player.seekTo).toHaveBeenCalledWith(20);
  expect(player.seekBy).toHaveBeenCalledWith(-5);
  expect(player.skipToIndex).toHaveBeenCalledWith(1);
  expect(player.setPlaybackSpeed).toHaveBeenCalledWith(1.5);
  await port.sleepAfterTime(60); await port.sleepAfterTrack(1); await port.cancelSleep();
  expect(player.sleepAfterTime).toHaveBeenCalledWith(60);
  expect(player.sleepAfterMediaItemAtIndex).toHaveBeenCalledWith(1);
  expect(player.cancelSleepTimer).toHaveBeenCalled();
  await port.sleepAfterTime(600, 30);
  expect(player.sleepAfterTime).toHaveBeenLastCalledWith(600, { fadeOutSeconds: 30 });
});

test("reads the native sleep timer so a reloaded UI can show it", async () => {
  const { port, player } = harness();
  expect(await port.getSleepTimer?.()).toBeNull();
  (player as any).getSleepTimer = jest.fn(() => ({ type: "time", remainingSeconds: 90, fadeOutSeconds: 30 }));
  expect(await port.getSleepTimer?.()).toEqual({ type: "time", remainingSeconds: 90, fadeOutSeconds: 30 });
  (player as any).getSleepTimer = jest.fn(() => ({ type: "mediaItem", index: 2 }));
  expect(await port.getSleepTimer?.()).toEqual({ type: "mediaItem", index: 2 });
});

test("maps subscriptions and returns a stable unsubscribe callback", () => {
  const { port, player, remove } = harness();
  const listener = jest.fn();
  const unsubscribe = port.subscribe("progress", listener);
  expect(player.addEventListener).toHaveBeenCalledWith("progress-event", listener);
  unsubscribe(); unsubscribe();
  expect(remove).toHaveBeenCalledTimes(1);
});

test("normalizes unknown native states", async () => {
  const { port, player } = harness();
  player.getPlaybackState.mockReturnValue("mystery");
  expect(await port.getState()).toBe("idle");
});

describe("connecting to the playback service", () => {
  // Like RNTP on a cold start: getters report an unconnected, empty player
  // (duration exactly 0) until the MediaController connects.
  function connectingPlayer(connectAfterPolls: number) {
    let polls = 0;
    const connected = () => polls > connectAfterPolls;
    return {
      setupPlayer: jest.fn(),
      getProgress: jest.fn(() => {
        polls++;
        return connected() ? { position: 0, duration: -9223372036854775.807 } : { position: 0, duration: 0 };
      }),
      getQueue: jest.fn(() => []),
      getPlaybackState: jest.fn(() => "idle"),
    };
  }

  test("setup waits until the player can actually take commands", async () => {
    const player = connectingPlayer(3);
    const port = createNativePlayerPort(player as any, {} as any);
    await port.setup({});
    expect(player.getProgress).toHaveBeenCalledTimes(4);
  });

  test("an already-live player (a queue, or real progress) counts as connected", async () => {
    expect(await waitUntilConnected({ getProgress: () => ({ position: 5, duration: 300 }) } as any, 0)).toBe(true);
    expect(await waitUntilConnected({ getProgress: () => ({ position: 0, duration: 0 }), getQueue: () => [{ mediaId: "b:0" }] } as any, 0)).toBe(true);
  });

  test("setup gives up waiting after a few seconds instead of hanging", async () => {
    jest.useFakeTimers();
    try {
      const player = connectingPlayer(Number.POSITIVE_INFINITY);
      const port = createNativePlayerPort(player as any, {} as any);
      let done = false;
      const setup = port.setup({}).then(() => { done = true; });
      await jest.advanceTimersByTimeAsync(4_900);
      expect(done).toBe(false);
      await jest.advanceTimersByTimeAsync(200);
      await setup;
      expect(done).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
