import { buildProgressUpdate } from "../progress";

test("builds resumable progress for a single 28-hour media item", () => {
  expect(buildProgressUpdate({ position: 54_321, duration: 100_800 }, 0, 1)).toEqual({
    position: 54_321,
    duration: 100_800,
    trackIndex: 0,
    finished: false,
  });
});

test("only marks the final media item finished near its end", () => {
  expect(buildProgressUpdate({ position: 99, duration: 100 }, 0, 1).finished).toBe(true);
  expect(buildProgressUpdate({ position: 99, duration: 100 }, 0, 2).finished).toBe(false);
});
