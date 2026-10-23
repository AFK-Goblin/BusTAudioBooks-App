/* global test */
import { formatDuration, formatSpeed, formatTime } from "../format";

test("compact durations round to the minute above a minute", () => {
  expect(formatDuration(4 * 3600 + 12 * 60 + 40)).toBe("4h 13m");
  expect(formatDuration(3 * 3600)).toBe("3h");
  expect(formatDuration(59 * 60 + 29)).toBe("59m");
  expect(formatDuration(42)).toBe("42s");
  expect(formatDuration(0)).toBe("0m");
  expect(formatDuration(Number.NaN)).toBe("0m");
});

test("speeds print without float noise", () => {
  expect(formatSpeed(1)).toBe("1×");
  expect(formatSpeed(1.25)).toBe("1.25×");
  expect(formatSpeed(1.1 + 0.05 + 0.05)).toBe("1.2×");
});

test("clock times keep their existing shape", () => {
  expect(formatTime(3725)).toBe("1:02:05");
  expect(formatTime(65)).toBe("1:05");
});

test("typed times: h:mm:ss, m:ss or plain minutes", () => {
  const { parseTime } = require("../format");
  expect(parseTime("1:23:45")).toBe(5025);
  expect(parseTime(" 23:05 ")).toBe(1385);
  expect(parseTime("90")).toBe(5400);
  expect(parseTime("1.5")).toBe(90);
  expect(parseTime("1:75")).toBeNull();
  expect(parseTime("abc")).toBeNull();
  expect(parseTime("")).toBeNull();
});
