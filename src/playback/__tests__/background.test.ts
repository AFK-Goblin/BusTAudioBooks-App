import { handleBackgroundEvent } from "../background";

const events = {
  progress: "progress", play: "play", pause: "pause", stop: "stop", next: "next", previous: "previous",
  forward: "forward", backward: "backward", seek: "seek", noisy: "noisy", playing: "playing", sleep: "sleep",
};

test.each([
  [{ type: "play" }, "play", []],
  [{ type: "pause" }, "pause", []],
  [{ type: "stop" }, "stop", []],
  [{ type: "next" }, "skipBy", [1]],
  [{ type: "previous" }, "skipBy", [-1]],
  [{ type: "forward", interval: 45 }, "seekBy", [45]],
  [{ type: "backward", interval: 15 }, "seekBy", [-15]],
  [{ type: "seek", position: 123 }, "seekTo", [123]],
  [{ type: "noisy" }, "pause", []],
] as const)("routes $method background commands", async (event, method, args) => {
  const session: any = { initialize: jest.fn(async () => {}), [method]: jest.fn(async () => {}) };
  await handleBackgroundEvent(event, session, events);
  expect(session.initialize).toHaveBeenCalled();
  expect(session[method]).toHaveBeenCalledWith(...args);
});

test("routes background progress through the session checkpoint pipeline", async () => {
  const session = { initialize: jest.fn(async () => {}), syncFromNative: jest.fn(async () => {}) };
  await handleBackgroundEvent({ type: "progress" }, session, events);
  expect(session.syncFromNative).toHaveBeenCalledWith("background-progress");
});

test("syncs native playing changes handled outside JavaScript", async () => {
  const session = { initialize: jest.fn(async () => {}), syncFromNative: jest.fn(async () => {}) };
  await handleBackgroundEvent({ type: "playing" }, session, events);
  expect(session.syncFromNative).toHaveBeenCalledWith("background-playing");
});

test("clears sleep state when the native timer triggers in background", async () => {
  const session = { initialize: jest.fn(async () => {}), handleSleepTriggered: jest.fn(async () => {}) };
  await handleBackgroundEvent({ type: "sleep" }, session, events);
  expect(session.handleSleepTriggered).toHaveBeenCalled();
});
