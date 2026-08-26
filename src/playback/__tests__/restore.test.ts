import { loadMediaItemsAtPosition } from "../restore";

test("waits for a long single-file book to be ready before restoring its position", async () => {
  const calls: string[] = [];
  let listener: ((event: { state: string }) => void) | undefined;
  const player = {
    addEventListener: (_event: string, callback: typeof listener) => {
      listener = callback;
      return { remove: jest.fn() };
    },
    setMediaItems: () => { calls.push("queue"); listener?.({ state: "ready" }); },
    seekTo: (position: number) => { calls.push(`seek:${position}`); },
  };

  await loadMediaItemsAtPosition(player, "state", [{}], 0, 54_321, 5);
  expect(calls).toEqual(["queue", "seek:54316"]);
});

test("clamps resume rewind at the beginning and permits exact recovery", async () => {
  const positions: number[] = [];
  let listener: ((event: { state: string }) => void) | undefined;
  const player = {
    addEventListener: (_event: string, callback: typeof listener) => {
      listener = callback; return { remove: jest.fn() };
    },
    setMediaItems: () => listener?.({ state: "ready" }),
    seekTo: (position: number) => positions.push(position),
  };
  await loadMediaItemsAtPosition(player, "state", [{}], 0, 3, 5);
  await loadMediaItemsAtPosition(player, "state", [{}], 0, 50, 0);
  expect(positions).toEqual([0, 50]);
});

test("does not delay a book that starts at zero", async () => {
  const player = {
    addEventListener: jest.fn(), setMediaItems: jest.fn(), seekTo: jest.fn(),
  };
  await loadMediaItemsAtPosition(player, "state", [{}], 0, 0);
  expect(player.setMediaItems).toHaveBeenCalled();
  expect(player.addEventListener).not.toHaveBeenCalled();
  expect(player.seekTo).not.toHaveBeenCalled();
});
