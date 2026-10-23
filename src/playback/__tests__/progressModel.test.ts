import { audiobookEstimate, bookProgress, estimateBookProgress, isBookFinished, queueRevision } from "../progressModel";

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

describe("whole-book estimates", () => {
  test("a single-file book is exact", () => {
    expect(estimateBookProgress({ trackIndex: 0, positionSeconds: 900, durationSeconds: 3600, trackCount: 1 }))
      .toEqual({ elapsedSeconds: 900, totalSeconds: 3600, remainingSeconds: 2700, percentage: 25, estimated: false });
  });

  test("every part measured gives an exact multipart total", () => {
    const result = estimateBookProgress({ trackIndex: 1, positionSeconds: 30, trackCount: 2, trackDurations: [60, 120] });
    expect(result).toMatchObject({ elapsedSeconds: 90, totalSeconds: 180, percentage: 50, estimated: false });
  });

  test("unplayed parts scale from measured seconds per byte", () => {
    // Part 0 is 600 s for 6 MB, so the 12 MB part 2 is inferred as 1200 s.
    const result = estimateBookProgress({
      trackIndex: 1, positionSeconds: 100, durationSeconds: 300, trackCount: 3,
      trackDurations: [600], sizes: [6_000_000, 3_000_000, 12_000_000],
    });
    expect(result.totalSeconds).toBeCloseTo(2100, 6);
    expect(result.elapsedSeconds).toBeCloseTo(700, 6);
    expect(result.estimated).toBe(true);
  });

  test("without sizes, unplayed parts take the average measured length", () => {
    const result = estimateBookProgress({ trackIndex: 0, positionSeconds: 60, durationSeconds: 600, trackCount: 4 });
    expect(result).toMatchObject({ totalSeconds: 2400, remainingSeconds: 2340, estimated: true });
  });

  test("with nothing measured it falls back to a parts fraction", () => {
    expect(estimateBookProgress({ trackIndex: 2, positionSeconds: 5, trackCount: 4 }))
      .toEqual({ elapsedSeconds: 5, percentage: 50, estimated: true });
  });

  test("library entries combine stored durations, file sizes and live position", () => {
    const entry = {
      files: [{ size: 100 }, { size: 100 }],
      progress: { trackIndex: 0, position: 10, duration: 50, trackDurations: [50] },
    };
    expect(audiobookEstimate(entry)).toMatchObject({ totalSeconds: 100, elapsedSeconds: 10, estimated: true });
    expect(audiobookEstimate(entry, { trackIndex: 1, positionSeconds: 25, durationSeconds: 50 }))
      .toMatchObject({ totalSeconds: 100, elapsedSeconds: 75, percentage: 75, estimated: false });
  });
});
