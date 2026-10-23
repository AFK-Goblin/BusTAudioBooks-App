/* global test, beforeEach */
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("expo-task-manager", () => ({ defineTask: jest.fn() }));
jest.mock("expo-background-task", () => ({
  BackgroundTaskResult: { Success: 1, Failed: 2 }, BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  getStatusAsync: jest.fn(async () => 2), registerTaskAsync: jest.fn(async () => {}),
}));
jest.mock("../api", () => ({ getStreams: jest.fn(), getSeries: jest.fn(), getSimilar: jest.fn() }));
jest.mock("../notify", () => ({ notify: jest.fn(async () => true), notificationsAllowed: jest.fn(async () => true) }));
jest.mock("../player", () => ({ refreshCarBrowse: jest.fn(async () => {}) }));
jest.mock("../downloads", () => ({ startDownload: jest.fn() }));
jest.mock("../toast", () => ({ showToast: jest.fn() }));

const api = require("../api");
const { notify } = require("../notify");
const downloads = require("../downloads");
const TaskManager = require("expo-task-manager");
const BackgroundTask = require("expo-background-task");
const { runBackgroundCheck, registerBackgroundCheck, BACKGROUND_CHECK } = require("../backgroundCheck");
const definedAtLoad = [...TaskManager.defineTask.mock.calls];
const { waitFor, stopWaiting } = require("../waiting");
const { upsertBook } = require("../library");
const { setSetting } = require("../settings");

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 23, 12).getTime();
const series = (released8) => ({
  name: "Dungeon Crawler Carl", position: "1", total: 2,
  books: [
    { position: "1", title: "Dungeon Crawler Carl", released: "2021-01-28" },
    { position: "8", title: "A Parade of Horribles", search: "A Parade of Horribles", released: released8 },
  ],
});

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  await stopWaiting("w");
  await setSetting("notifyReady", true);
  await setSetting("notifyReleases", true);
});

test("the task is defined at load and registered for about every half hour", async () => {
  expect(definedAtLoad).toEqual([[BACKGROUND_CHECK, expect.any(Function)]]);
  expect(await registerBackgroundCheck()).toBe(true);
  expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith(BACKGROUND_CHECK, { minimumInterval: 30 });
});

test("in the background a ready book is announced once, not downloaded", async () => {
  await waitFor({ id: "w", title: "Slow Book" });
  api.getStreams.mockResolvedValue({ ready: true, streams: [{ title: "a", url: "https://cdn/a" }] });
  api.getSeries.mockResolvedValue(null);
  await runBackgroundCheck(NOW);
  await runBackgroundCheck(NOW + 60_000);
  expect(downloads.startDownload).not.toHaveBeenCalled();
  expect(notify.mock.calls.filter(([title]) => title === "Ready to download")).toHaveLength(1);
  expect(notify).toHaveBeenCalledWith("Ready to download", expect.stringContaining("Slow Book"), { screen: "library" });
});

test("a new book in your series is announced once, the day after it comes out", async () => {
  await upsertBook({ id: "dcc1", title: "Dungeon Crawler Carl - Matt Dinniman", files: [], progress: { finished: true, position: 9, lastPlayed: 1 } });
  api.getSeries.mockResolvedValue(series("2026-10-24"));
  await runBackgroundCheck(NOW); // first run only starts the clock
  expect(notify).not.toHaveBeenCalled();
  await runBackgroundCheck(NOW + DAY); // it's out now
  expect(notify).toHaveBeenCalledWith("New in Dungeon Crawler Carl", "“A Parade of Horribles” (book 8) is out.", { query: "A Parade of Horribles" });
  await runBackgroundCheck(NOW + 2 * DAY);
  expect(notify).toHaveBeenCalledTimes(1);
});

test("with release alerts off nothing is announced", async () => {
  await setSetting("notifyReleases", false);
  await upsertBook({ id: "dcc1", title: "Dungeon Crawler Carl", files: [], progress: { finished: true, position: 9, lastPlayed: 1 } });
  api.getSeries.mockResolvedValue(series("2026-10-24"));
  await runBackgroundCheck(NOW);
  await runBackgroundCheck(NOW + DAY);
  expect(notify).not.toHaveBeenCalled();
});
