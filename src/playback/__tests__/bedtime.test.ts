import { followBedtime, inBedtime } from "../bedtime";
import type { PlaybackSnapshot } from "../types";

const at = (hour: number, minute = 0) => new Date(2026, 9, 22, hour, minute).getTime();
const book = { id: "b", title: "Book", files: [] };
const snap = (patch: Partial<PlaybackSnapshot>): PlaybackSnapshot => ({
  status: "paused", intent: "paused", book, activeTrackIndex: 0, positionSeconds: 0, durationSeconds: 0, rate: 1, sleep: { mode: "off" }, ...patch,
});

test("the bedtime window wraps midnight and closes at 6 am", () => {
  expect(inBedtime(new Date(at(22, 0)), 22)).toBe(true);
  expect(inBedtime(new Date(at(2, 30)), 22)).toBe(true);
  expect(inBedtime(new Date(at(6, 0)), 22)).toBe(false);
  expect(inBedtime(new Date(at(21, 59)), 22)).toBe(false);
  expect(inBedtime(new Date(at(0, 10)), 0)).toBe(true);
  expect(inBedtime(new Date(at(23, 0)), 0)).toBe(false);
});

function harness(settings: Record<string, unknown>, now: number) {
  let listener: (s: PlaybackSnapshot) => void = () => {};
  const setSleep = jest.fn(async () => {});
  followBedtime({ subscribe: (l) => { listener = l; return () => {}; }, settings: () => settings, setSleep, now: () => now, fadeOutSeconds: 30 });
  return { emit: (s: PlaybackSnapshot) => listener(s), setSleep };
}

test("starting to listen late at night arms the timer once per start", () => {
  const h = harness({ bedtimeTimer: true, bedtimeStart: 22, bedtimeMinutes: 45, sleepFade: true }, at(23, 15));
  h.emit(snap({}));
  h.emit(snap({ intent: "playing", status: "playing" }));
  expect(h.setSleep).toHaveBeenCalledWith(45, { fadeOutSeconds: 30 });
  // Still playing (progress ticks): no re-arm, even after the listener turned it off.
  h.emit(snap({ intent: "playing", status: "playing" }));
  expect(h.setSleep).toHaveBeenCalledTimes(1);
  // Paused by the timer, resumed later that night: a fresh timer.
  h.emit(snap({ intent: "paused" }));
  h.emit(snap({ intent: "playing" }));
  expect(h.setSleep).toHaveBeenCalledTimes(2);
});

test("never overrides a running timer, daytime listening, or the setting being off", () => {
  const running = harness({ bedtimeTimer: true }, at(23));
  running.emit(snap({ intent: "playing", sleep: { mode: "timer", endsAt: at(23, 30) } }));
  expect(running.setSleep).not.toHaveBeenCalled();
  const day = harness({ bedtimeTimer: true }, at(15));
  day.emit(snap({ intent: "playing" }));
  expect(day.setSleep).not.toHaveBeenCalled();
  const off = harness({ bedtimeTimer: false }, at(23));
  off.emit(snap({ intent: "playing" }));
  expect(off.setSleep).not.toHaveBeenCalled();
  const noFade = harness({ bedtimeTimer: true, sleepFade: false }, at(1));
  noFade.emit(snap({ intent: "playing" }));
  expect(noFade.setSleep).toHaveBeenCalledWith(30, {});
});
