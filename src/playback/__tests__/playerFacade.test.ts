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

test("opening the book that's already loaded resumes it instead of reloading", async () => {
  mockSession.getSnapshot.mockReturnValue({ book: { id: "book" }, status: "paused", rate: 1, sleep: { mode: "off" } } as any);
  mockSession.loadBook.mockClear();
  mockSession.play.mockClear();
  await player.resumeOrLoad({ id: "book", progress: { position: 50, trackIndex: 1 } });
  expect(mockSession.play).toHaveBeenCalled();
  expect(mockSession.loadBook).not.toHaveBeenCalled();
  // A different book, "from the beginning", or a broken session all load.
  await player.resumeOrLoad({ id: "other", progress: { position: 50, trackIndex: 1 } });
  expect(mockSession.loadBook).toHaveBeenLastCalledWith({ id: "other", progress: { position: 50, trackIndex: 1 } }, 1, 50, {});
  await player.resumeOrLoad({ id: "book", progress: { position: 50 } }, true);
  expect(mockSession.loadBook).toHaveBeenLastCalledWith({ id: "book", progress: { position: 50 } }, 0, 0, {});
  mockSession.getSnapshot.mockReturnValue({ book: { id: "book" }, status: "error", rate: 1, sleep: { mode: "off" } } as any);
  await player.resumeOrLoad({ id: "book", progress: { position: 50 } });
  expect(mockSession.loadBook).toHaveBeenCalledTimes(3);
});
