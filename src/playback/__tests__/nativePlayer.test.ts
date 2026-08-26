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
import { createNativePlayerPort } from "../nativePlayer";

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
