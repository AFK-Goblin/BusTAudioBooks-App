/* global test, beforeEach */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { bestStreak, dailySeries, dayKey, flushListening, followListening, summarize } from "../stats";

beforeEach(() => AsyncStorage.clear());

function harness(start) {
  let t = start;
  let listener = () => {};
  followListening({ subscribe: (l) => { listener = l; return () => {}; }, now: () => t });
  const book = { id: "b", title: "Book", files: [] };
  return {
    at: (seconds, position, patch = {}) => {
      t = start + seconds * 1000;
      listener({ book, status: "playing", intent: "playing", activeTrackIndex: 0, positionSeconds: position, rate: 1, ...patch });
    },
  };
}
const stored = async () => JSON.parse(await AsyncStorage.getItem("bustaudio_listening")).days;

test("counts real listening, not seeks, skips or buffering", async () => {
  const start = new Date(2026, 9, 23, 20, 0, 0).getTime();
  const h = harness(start);
  h.at(0, 100);
  h.at(5, 105); // +5 s
  h.at(10, 110); // +5 s
  h.at(12, 900); // a seek: position jumped, not listening
  h.at(17, 905); // +5 s
  h.at(22, 912.5, { rate: 1.5 }); // 7.5 s of book at 1.5× = 5 s of listening
  h.at(25, 914, { activeTrackIndex: 1 }); // part change: baseline resets
  h.at(30, 919, { activeTrackIndex: 1 }); // +5 s
  h.at(32, 921, { activeTrackIndex: 1, intent: "paused", status: "paused" }); // the last 2 s before pausing count
  h.at(600, 921, { activeTrackIndex: 1, intent: "paused", status: "paused" }); // paused time doesn't
  await flushListening();
  expect((await stored())[dayKey(start)]).toBeCloseTo(27, 6);
});

test("summaries: today, last 7 days and the day streak", () => {
  const now = new Date(2026, 9, 23, 12).getTime();
  const days = {
    [dayKey(now)]: 600,
    [dayKey(now - 86_400_000)]: 1200,
    [dayKey(now - 2 * 86_400_000)]: 90,
    [dayKey(now - 3 * 86_400_000)]: 30, // under a minute: breaks the streak
    [dayKey(now - 10 * 86_400_000)]: 5000, // outside the week
  };
  expect(summarize(days, now)).toEqual({ today: 600, week: 1920, month: 6920, total: 6920, streak: 3, best: 3, activeDays: 4 });
  // Nothing yet today: yesterday's streak still stands.
  const { [dayKey(now)]: _today, ...noToday } = days;
  expect(summarize(noToday, now).streak).toBe(2);
});

test("the daily chart covers consecutive days, oldest first, and the best streak can be in the past", () => {
  const now = new Date(2026, 2, 31, 9).getTime(); // spans a month end
  const series = dailySeries({ "2026-03-30": 300, "2026-03-31": 120 }, 14, now);
  expect(series).toHaveLength(14);
  expect(series[0].key).toBe("2026-03-18");
  expect(series.slice(-3).map((d) => [d.key, d.seconds])).toEqual([["2026-03-29", 0], ["2026-03-30", 300], ["2026-03-31", 120]]);
  expect(new Set(series.map((d) => d.key)).size).toBe(14);
  const days = { "2026-01-30": 90, "2026-01-31": 90, "2026-02-01": 90, "2026-02-02": 90, "2026-02-03": 10, "2026-03-30": 300, "2026-03-31": 120 };
  expect(bestStreak(days)).toBe(4); // across the month boundary; the 10 s day doesn't count
  expect(summarize(days, now)).toMatchObject({ streak: 2, best: 4 });
});

test("listening is also counted per book, and a backup merge never double-counts it", async () => {
  const { listenedTo, mergeListening } = require("../stats");
  const start = new Date(2026, 9, 23, 20, 0, 0).getTime();
  const h = harness(start);
  h.at(0, 100);
  h.at(30, 130);
  await flushListening();
  expect(await listenedTo("b")).toBeCloseTo(30, 6);
  expect(JSON.parse(await AsyncStorage.getItem("bustaudio_listening")).books).toEqual({ b: 30 });
  await mergeListening({}, { b: 20, other: 600, bad: -5 });
  await mergeListening({}, { b: 20, other: 600 });
  expect(await listenedTo("b")).toBeCloseTo(30, 6);
  expect(await listenedTo("other")).toBe(600);
  expect(await listenedTo("bad")).toBe(0);
});
