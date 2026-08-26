import { bookProgress, isBookFinished, queueRevision } from "../progressModel";

test("queue revision ignores expiring URLs but changes with stable file identity", () => {
  const base = { id: "book:1", title: "Book", files: [{ filename: "a.mp3", title: "Part 1", url: "old" }] };
  expect(queueRevision(base)).toBe(queueRevision({ ...base, files: [{ ...base.files[0], url: "fresh" }] }));
  expect(queueRevision(base)).not.toBe(queueRevision({ ...base, files: [{ filename: "b.mp3", title: "Part 1", url: "old" }] }));
});

test("calculates a 28-hour single-file book without losing precision", () => {
  const progress = bookProgress(0, 45_000.5, [100_800]);
  expect(progress).toMatchObject({
    elapsedSeconds: 45_000.5,
    totalSeconds: 100_800,
    remainingSeconds: 55_799.5,
  });
  expect(progress.percentage).toBeCloseTo(44.64335317460318, 12);
});

test("adds completed track durations for multipart progress", () => {
  expect(bookProgress(1, 30, [60, 120])).toEqual({
    elapsedSeconds: 90, totalSeconds: 180, remainingSeconds: 90, percentage: 50,
  });
});

test("reports partial elapsed time without inventing totals", () => {
  expect(bookProgress(2, 30, [60, undefined, 120])).toEqual({ elapsedSeconds: 90 });
});

test("clamps invalid indices and positions", () => {
  expect(bookProgress(9, 999, [60, 120])).toEqual({
    elapsedSeconds: 180, totalSeconds: 180, remainingSeconds: 0, percentage: 100,
  });
  expect(bookProgress(-1, -20, [60])).toMatchObject({ elapsedSeconds: 0, percentage: 0 });
});

test("only finishes at the final track threshold or native queue end", () => {
  expect(isBookFinished(0, 2, 59, 60, false)).toBe(false);
  expect(isBookFinished(1, 2, 44, 60, false)).toBe(false);
  expect(isBookFinished(1, 2, 45, 60, false)).toBe(true);
  expect(isBookFinished(1, 2, 0, 0, true)).toBe(true);
});
