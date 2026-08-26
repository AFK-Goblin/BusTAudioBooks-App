const mockSession = {
  initialize: jest.fn(async () => ({})), loadBook: jest.fn(async () => {}), play: jest.fn(async () => {}),
  pause: jest.fn(async () => {}), seekTo: jest.fn(async () => {}), seekBy: jest.fn(async () => {}),
  skipTo: jest.fn(async () => {}), skipBy: jest.fn(async () => {}), setRate: jest.fn(async () => {}),
  setSleep: jest.fn(async () => {}), checkpoint: jest.fn(async () => {}),
  getSnapshot: jest.fn(() => ({ book: { id: "book" }, rate: 1.25, sleep: { mode: "timer", endsAt: 99 } })),
  subscribe: jest.fn(() => jest.fn()),
};

jest.mock("../runtime", () => ({ playbackSession: mockSession }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const player = require("../../player");

test("preserves existing player facade call signatures", async () => {
  await player.setupPlayer();
  await player.loadBook({ id: "book", files: [{}] }, 2, 50, { play: false, rewindOnResume: false });
  expect(mockSession.initialize).toHaveBeenCalled();
  expect(mockSession.loadBook).toHaveBeenCalledWith({ id: "book", files: [{}] }, 2, 50, { play: false, rewindOnResume: false });
  expect(player.getCurrentBook()).toEqual({ id: "book" });
  expect(await player.getRate()).toBe(1.25);
  expect(player.getSleep()).toEqual({ mode: "timer", until: 99 });
});

test("maps legacy end-of-track sleep and transport commands", async () => {
  await player.setSleep("eot");
  await player.play(); await player.pause(); await player.seekTo(10); await player.seekBy(-5); await player.skipToIndex(3);
  expect(mockSession.setSleep).toHaveBeenCalledWith("end-of-track");
  expect(mockSession.play).toHaveBeenCalled();
  expect(mockSession.pause).toHaveBeenCalled();
  expect(mockSession.seekTo).toHaveBeenCalledWith(10);
  expect(mockSession.seekBy).toHaveBeenCalledWith(-5);
  expect(mockSession.skipTo).toHaveBeenCalledWith(3);
});
