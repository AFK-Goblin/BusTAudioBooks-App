/* global test, beforeEach */
import React from "react";
import { Alert } from "react-native";
import { render as rtlRender, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ---- native + service seams ------------------------------------------------------
const mockSnapshot = { current: null };
const mockProgress = { position: 0, duration: 0 };
jest.mock("@rntp/player", () => ({
  __esModule: true,
  default: { getProgress: jest.fn(async () => ({ position: 0 })) },
  useProgress: () => mockProgress,
  useIsPlaying: () => false,
  useActiveMediaItem: () => ({ title: "Book", extras: { trackIndex: 0 } }),
}));
jest.mock("@react-native-community/slider", () => {
  const { View } = require("react-native");
  return function Slider(props) { return <View testID="slider" {...props} />; };
});
jest.mock("../player", () => ({
  usePlaybackSnapshot: () => mockSnapshot.current,
  getCurrentBook: () => mockSnapshot.current && mockSnapshot.current.book,
  play: jest.fn(async () => {}), pause: jest.fn(async () => {}), seekTo: jest.fn(async () => {}),
  seekBy: jest.fn(async () => {}), skipToIndex: jest.fn(async () => {}), setRate: jest.fn(async () => {}),
  setSleep: jest.fn(async () => {}), retryPlayback: jest.fn(async () => {}), closeBook: jest.fn(async () => {}),
  loadBook: jest.fn(async () => {}), resumeOrLoad: jest.fn(async () => {}), playFrom: jest.fn(async () => {}),
}));

jest.mock("../chapters/index", () => ({ ...jest.requireActual("../chapters/index"), embeddedChapters: jest.fn(async () => null) }));
jest.mock("../downloads", () => ({
  startDownload: jest.fn(), deleteDownload: jest.fn(async () => {}), retryDownload: jest.fn(), cancelDownload: jest.fn(async () => {}),
  downloadsSizeBytes: jest.fn(async () => 0), deleteAllDownloads: jest.fn(async () => {}), downloadSizes: jest.fn(async () => []),
}));
jest.mock("../api", () => ({
  getStreams: jest.fn(async () => ({ ready: true, streams: [] })),
  getDetails: jest.fn(async () => { throw new Error("Server error (HTTP 404)"); }),
  search: jest.fn(async () => []),
  health: jest.fn(async () => ({ ok: true })),
  getSeries: jest.fn(async () => null),
  getSimilar: jest.fn(async () => null),
}));

const player = require("../player");
const chaptersService = require("../chapters/index");
const downloads = require("../downloads");
const api = require("../api");
const library = require("../library");
const { setSetting } = require("../settings");
const PlayerScreen = require("../../screens/PlayerScreen").default;
const LibraryScreen = require("../../screens/LibraryScreen").default;
const BookScreen = require("../../screens/BookScreen").default;
const SearchScreen = require("../../screens/SearchScreen").default;
const SettingsScreen = require("../../screens/SettingsScreen").default;

const nav = { navigate: jest.fn(), goBack: jest.fn(), reset: jest.fn() };
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
// The app root provides safe-area insets; the bottom sheets read them.
const render = (element) => rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{element}</SafeAreaProvider>);
const m4b = { id: "book", title: "The Adventures", author: "Doyle", files: [{ filename: "Book.m4b", url: "https://cdn/x", size: 1000 }] };
const CHAPTERS = [
  { start: 0, title: "A Scandal in Bohemia" },
  { start: 3983, title: "The Red-Headed League" },
  { start: 8049, title: "A Case of Identity" },
];

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  Object.assign(mockProgress, { position: 4000, duration: 12000 });
  mockSnapshot.current = { book: m4b, status: "paused", intent: "paused", rate: 1, sleep: { mode: "off" }, activeTrackIndex: 0 };
  chaptersService.embeddedChapters.mockResolvedValue(CHAPTERS);
  await setSetting("sleepFade", true);
});

test("the player shows the current embedded chapter and steps between chapters", async () => {
  await render(<PlayerScreen nav={nav} />);
  expect(await screen.findAllByText("The Red-Headed League")).not.toHaveLength(0);
  expect(screen.getByText(/Ch 2\/3 · 1h 7m left/)).toBeTruthy();
  expect(screen.getByText("2h 13m left in book")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Next chapter"));
  expect(player.seekTo).toHaveBeenLastCalledWith(8049);
  // 17 s into the chapter: "previous" restarts it rather than going back one.
  await fireEvent.press(screen.getByLabelText("Previous chapter"));
  expect(player.seekTo).toHaveBeenLastCalledWith(3983);
});

test("a single-file book without chapters can't 'previous' itself back to the start", async () => {
  chaptersService.embeddedChapters.mockResolvedValue(null);
  await render(<PlayerScreen nav={nav} />);
  await waitFor(() => expect(chaptersService.embeddedChapters).toHaveBeenCalled());
  await fireEvent.press(screen.getByLabelText("Previous part"));
  expect(player.seekTo).not.toHaveBeenCalled();
  expect(player.skipToIndex).not.toHaveBeenCalled();
});

test("a playback error is shown with a working Retry", async () => {
  mockSnapshot.current = { ...mockSnapshot.current, status: "error", error: { code: "stream-recovery-failed", message: "Could not refresh this audiobook stream", retryable: true } };
  await render(<PlayerScreen nav={nav} />);
  expect(await screen.findByText("Could not refresh this audiobook stream")).toBeTruthy();
  await fireEvent.press(screen.getByText("Retry"));
  expect(player.retryPlayback).toHaveBeenCalled();
});

test("sleep sheet: fading timers and an end-of-chapter timer scaled by speed", async () => {
  mockSnapshot.current = { ...mockSnapshot.current, rate: 1.5 };
  await render(<PlayerScreen nav={nav} />);
  await screen.findAllByText("The Red-Headed League");
  await fireEvent.press(screen.getByText("Sleep"));
  await fireEvent.press(screen.getByText("15 min"));
  expect(player.setSleep).toHaveBeenLastCalledWith(15, { fadeOutSeconds: 30 });
  await fireEvent.press(screen.getByText("Sleep"));
  await fireEvent.press(screen.getByText("End of chapter"));
  // 4049 s of chapter left at 1.5× ≈ 2699 s of listening.
  const [minutes, options] = player.setSleep.mock.calls.at(-1);
  expect(minutes * 60).toBeCloseTo(4049 / 1.5, 3);
  expect(options).toEqual({ reason: "chapter" });
});

test("speed sheet steps by 0.05 and saves it as the default", async () => {
  await render(<PlayerScreen nav={nav} />);
  await screen.findAllByText("The Red-Headed League");
  await fireEvent.press(screen.getByText("1×"));
  await fireEvent.press(screen.getByLabelText("Faster"));
  expect(player.setRate).toHaveBeenLastCalledWith(1.05);
  expect(require("../settings").getSettings().speed).toBe(1.05);
});

test("library: deleting a download keeps progress; the menu offers finished/reset", async () => {
  await library.upsertBook({
    id: "dl", title: "Downloaded Book", downloaded: true, downloadedAt: 1, storageDir: "dl",
    files: [{ uri: "file:///docs/bustaudio/dl/a.m4b", size: 100 }],
    progress: { position: 50, duration: 100, trackIndex: 0, trackDurations: [100] },
  });
  const alert = jest.spyOn(Alert, "alert").mockImplementation((_title, _body, buttons) => buttons.at(-1).onPress());
  await render(<LibraryScreen nav={nav} />);
  expect(await screen.findByText("50% · 50s left · 0:50")).toBeTruthy();
  // In progress AND downloaded: listed under both Continue Listening and Downloads.
  await fireEvent.press(screen.getAllByLabelText("More actions for Downloaded Book")[0]);
  expect(screen.getByText("Mark as finished")).toBeTruthy();
  expect(screen.getByText("Reset progress")).toBeTruthy();
  await fireEvent.press(screen.getByText("Delete download"));
  await waitFor(() => expect(downloads.deleteDownload).toHaveBeenCalledWith("dl"));
  await waitFor(async () => expect((await library.getBook("dl")).downloaded).toBeUndefined());
  expect((await library.getBook("dl")).progress.position).toBe(50);
  alert.mockRestore();
});

test("book details play a downloaded copy offline without resolving on TorBox", async () => {
  await library.upsertBook({
    id: "dl", title: "Downloaded Book", downloaded: true,
    files: [{ uri: "file:///docs/bustaudio/dl/a.m4b" }], progress: { position: 600, trackIndex: 0, duration: 1200 },
  });
  await render(<BookScreen nav={nav} params={{ item: { id: "dl", title: "Downloaded Book" } }} />);
  expect(await screen.findByText("Downloaded · plays offline")).toBeTruthy();
  expect(screen.getByText("Start from the beginning")).toBeTruthy();
  expect(api.getStreams).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("Resume"));
  await waitFor(() => expect(player.resumeOrLoad).toHaveBeenCalledWith(expect.objectContaining({ id: "dl", progress: expect.objectContaining({ position: 600 }) }), false));
});

test("book details re-check TorBox on their own while it fetches", async () => {
  jest.useFakeTimers();
  try {
    api.getStreams
      .mockResolvedValueOnce({ ready: false, status: "Downloading on TorBox (40%). Try again shortly.", streams: [] })
      .mockResolvedValueOnce({ ready: true, streams: [{ title: "a.mp3", url: "https://cdn/a", filename: "a.mp3", size: 10 }] });
    await render(<BookScreen nav={nav} params={{ item: { id: "new", title: "New Book" } }} />);
    expect(await screen.findByText("Downloading on TorBox (40%). Try again shortly.")).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(15_000); });
    expect(await screen.findByText("Stream now")).toBeTruthy();
    expect(api.getStreams).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

test("book details show the synopsis and keep it for offline use", async () => {
  await library.upsertBook({ id: "dl", title: "Downloaded Book", downloaded: true, files: [{ uri: "file:///x/a.m4b" }] });
  const description = "Ryland Grace wakes up alone on a spaceship. ".repeat(10).trim();
  api.getDetails.mockResolvedValueOnce({ description, genre: "Sci-Fi & Fantasy", year: 2021 });
  await render(<BookScreen nav={nav} params={{ item: { id: "dl", title: "Downloaded Book" } }} />);
  expect(await screen.findByText("Sci-Fi & Fantasy")).toBeTruthy();
  expect(screen.getByText("2021")).toBeTruthy();
  expect(screen.getByText(description)).toBeTruthy();
  expect(screen.getByText("Show more")).toBeTruthy();
  await waitFor(async () => expect(await library.getSavedDetails("dl")).toEqual({ description, genre: "Sci-Fi & Fantasy", year: 2021 }));
});

test("search results say which books are already yours", async () => {
  await library.upsertBook({ id: "have", title: "Owned", downloaded: true, files: [{ uri: "file:///x" }] });
  await library.upsertBook({ id: "half", title: "Half", files: [{}], progress: { position: 1800, duration: 3600, trackIndex: 0 } });
  api.search.mockResolvedValueOnce([
    { id: "have", title: "Owned" }, { id: "half", title: "Half" }, { id: "new", title: "Brand New" },
  ]);
  await render(<SearchScreen nav={nav} />);
  await fireEvent.changeText(screen.getByPlaceholderText("Search audiobooks…"), "dune");
  await fireEvent(screen.getByPlaceholderText("Search audiobooks…"), "submitEditing");
  expect(await screen.findByText("✓ Downloaded")).toBeTruthy();
  expect(screen.getByText("In progress · 50%")).toBeTruthy();
  expect(screen.getByText("Brand New")).toBeTruthy();
});

test("a big library gets a filter, and downloads show their size", async () => {
  for (let i = 0; i < 8; i++) {
    await library.upsertBook({ id: `b${i}`, title: `Book ${i}`, author: i === 3 ? "Ursula K. Le Guin" : "Someone", downloaded: true, downloadedAt: i, files: [{ uri: "file:///x", size: 5 * 1024 * 1024 }] });
  }
  await render(<LibraryScreen nav={nav} />);
  expect(await screen.findByText("Book 7")).toBeTruthy();
  expect(screen.getAllByText("Downloaded · 5.0 MB")).toHaveLength(8);
  await fireEvent.changeText(screen.getByPlaceholderText("Filter your library"), "le guin");
  expect(screen.getByText("Book 3")).toBeTruthy();
  expect(screen.queryByText("Book 7")).toBeNull();
  await fireEvent.changeText(screen.getByPlaceholderText("Filter your library"), "zzz");
  expect(screen.getByText(/Nothing in your library matches/)).toBeTruthy();
});

test("bookmarks take notes; a finished book offers to start again", async () => {
  await library.upsertBook({ id: "book", title: "The Adventures", files: m4b.files, bookmarks: [{ position: 4000, trackIndex: 0, createdAt: 7 }] });
  await render(<PlayerScreen nav={nav} />);
  await fireEvent.press(await screen.findByLabelText("Open bookmarks"));
  expect(await screen.findByText(/1:06:40 · The Red-Headed League/)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Edit note"));
  await fireEvent.changeText(screen.getByPlaceholderText("What's worth remembering here?"), "Jabez Wilson");
  await fireEvent.press(screen.getByText("Save"));
  expect(await screen.findByText("Jabez Wilson")).toBeTruthy();
  expect((await library.getBook("book")).bookmarks[0].note).toBe("Jabez Wilson");
});

test("the end of a book says so", async () => {
  mockSnapshot.current = { ...mockSnapshot.current, status: "ended", intent: "stopped" };
  await render(<PlayerScreen nav={nav} />);
  expect(await screen.findByText("You finished this book 🎉")).toBeTruthy();
  await fireEvent.press(screen.getByText("Listen again"));
  await waitFor(() => expect(player.play).toHaveBeenCalled());
  expect(player.skipToIndex).toHaveBeenCalledWith(0);
});

test("a preparing download does not invent a Wi-Fi waiting state", async () => {
  await setSetting("wifiOnly", true);
  const store = require("../downloadStore");
  store.startTracking("w", { title: "Waiting Book", count: 1, files: [{ size: 100 }] });
  await render(<LibraryScreen nav={nav} />);
  expect(await screen.findByText("Preparing download · Wi-Fi only enabled")).toBeTruthy();
  expect(screen.queryByText(/Waiting for Wi-Fi/)).toBeNull();
  await act(async () => {
    store.dismissTracking("w");
    await setSetting("wifiOnly", false);
  });
});

test("settings: the bedtime timer reveals its options and saves them", async () => {
  await render(<SettingsScreen nav={nav} />);
  expect(screen.queryByText("Starting at")).toBeNull();
  await fireEvent(screen.getByLabelText("Bedtime sleep timer"), "valueChange", true);
  expect(await screen.findByText("Starting at")).toBeTruthy();
  await fireEvent.press(screen.getByText("11 pm"));
  await fireEvent.press(screen.getAllByText("45 min")[0]); // the bedtime one, above the daily goal's
  const { getSettings } = require("../settings");
  expect(getSettings()).toMatchObject({ bedtimeTimer: true, bedtimeStart: 23, bedtimeMinutes: 45 });
  expect(screen.getByText(/Start a 45-minute sleep timer whenever you start listening between 11 pm and 6 am/)).toBeTruthy();
  await act(async () => { await setSetting("bedtimeTimer", false); });
});

test("search can narrow results to instant (cached) torrents", async () => {
  api.search.mockResolvedValueOnce([
    { id: "a", title: "Cached One", cached: true }, { id: "b", title: "Slow One", cached: false }, { id: "c", title: "Cached Two", cached: true },
  ]);
  await render(<SearchScreen nav={nav} />);
  await fireEvent.changeText(screen.getByPlaceholderText("Search audiobooks…"), "x");
  await fireEvent(screen.getByPlaceholderText("Search audiobooks…"), "submitEditing");
  await fireEvent.press(await screen.findByText("⚡ Instant only (2)"));
  expect(screen.getByText("⚡ Instant only · 2 of 3")).toBeTruthy();
  expect(screen.queryByText("Slow One")).toBeNull();
  await act(async () => { await setSetting("instantOnly", false); });
  expect(screen.getByText("Slow One")).toBeTruthy();
});

test("the player scrubs within the chapter, and can switch to the whole book", async () => {
  await render(<PlayerScreen nav={nav} />);
  // Chapter 2 runs 3983 → 8049 s; we're at 4000 s.
  expect(await screen.findByText("0:17")).toBeTruthy();
  expect(screen.getByText("1:07:46")).toBeTruthy();
  expect(screen.getByTestId("slider").props).toMatchObject({ minimumValue: 3983, maximumValue: 8049, value: 4000 });
  expect(screen.getByText("Up next · A Case of Identity")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Show time left"));
  expect(screen.getByText("-1:07:29")).toBeTruthy();
  await fireEvent.press(screen.getByText("Whole book"));
  expect(screen.getByText("-2:13:20")).toBeTruthy(); // 12000 s long, at 4000 s
  expect(screen.getByTestId("slider").props).toMatchObject({ minimumValue: 0, maximumValue: 12000 });
  await act(async () => { await setSetting("showRemaining", false); await setSetting("scrubScope", "chapter"); });
});

test("the player menu can close the book", async () => {
  await render(<PlayerScreen nav={nav} />);
  await fireEvent.press(await screen.findByLabelText("More"));
  expect(screen.getByText("Book details")).toBeTruthy();
  await fireEvent.press(screen.getByText("Close book"));
  await waitFor(() => expect(player.closeBook).toHaveBeenCalled());
  expect(nav.goBack).toHaveBeenCalled();
});

test("the library can be sorted by title or author", async () => {
  await library.upsertBook({ id: "z", title: "Zebra Tales", author: "Adams", downloaded: true, downloadedAt: 3, files: [{ uri: "file:///z" }] });
  await library.upsertBook({ id: "m", title: "Middle Book", author: "Carter", downloaded: true, downloadedAt: 2, files: [{ uri: "file:///m" }] });
  await library.upsertBook({ id: "a", title: "Apple Story", author: "Brown", downloaded: true, downloadedAt: 1, files: [{ uri: "file:///a" }] });
  await render(<LibraryScreen nav={nav} />);
  const titles = () => screen.getAllByText(/Tales|Book|Story/).map((n) => n.props.children);
  expect(await screen.findByText("Zebra Tales")).toBeTruthy();
  expect(titles()).toEqual(["Zebra Tales", "Middle Book", "Apple Story"]); // most recently downloaded first
  await fireEvent.press(screen.getByText("Sort: Recent"));
  expect(titles()).toEqual(["Apple Story", "Middle Book", "Zebra Tales"]);
  await fireEvent.press(screen.getByText("Sort: Title"));
  expect(titles()).toEqual(["Zebra Tales", "Apple Story", "Middle Book"]); // Adams, Brown, Carter
  await act(async () => { await setSetting("librarySort", "recent"); });
});

test("an author on a book page searches for their other books", async () => {
  await render(<BookScreen nav={nav} params={{ item: { id: "x", title: "Dune", author: "Frank Herbert" } }} />);
  await fireEvent.press(await screen.findByLabelText("More by Frank Herbert"));
  expect(nav.navigate).toHaveBeenCalledWith("search", { query: "Frank Herbert" });
  api.search.mockResolvedValueOnce([{ id: "y", title: "Children of Dune", author: "Frank Herbert" }]);
  await render(<SearchScreen nav={{ ...nav, depth: 2 }} params={{ query: "Frank Herbert" }} />);
  expect(await screen.findByText("Children of Dune")).toBeTruthy();
  expect(api.search).toHaveBeenLastCalledWith("Frank Herbert", 1);
  expect(screen.getByText("Back")).toBeTruthy();
});

test("the library shows today's and this week's listening", async () => {
  const stats = require("../stats");
  const listener = [];
  stats.followListening({ subscribe: (l) => { listener.push(l); return () => {}; }, now: () => Date.now() });
  const book = { id: "s", title: "S", files: [] };
  const t0 = Date.now();
  listener[0]({ book, status: "playing", intent: "playing", activeTrackIndex: 0, positionSeconds: 0, rate: 1 });
  // 90 s of listening, reported as one consistent step.
  jest.spyOn(Date, "now").mockReturnValue(t0 + 90_000);
  listener[0]({ book, status: "paused", intent: "paused", activeTrackIndex: 0, positionSeconds: 90, rate: 1 });
  Date.now.mockRestore();
  await stats.flushListening();
  await library.upsertBook({ id: "s", title: "S", downloaded: true, files: [{ uri: "file:///s" }] });
  await render(<LibraryScreen nav={nav} />);
  expect(await screen.findByText(/Today 2m · Last 7 days 2m/)).toBeTruthy();
});

test("home leads with a big card for the book in progress, resumable in place", async () => {
  await library.upsertBook({ id: "h", title: "Hero Book", author: "Someone", files: [{}, {}], progress: { position: 600, trackIndex: 1, duration: 1200, trackDurations: [1200, 1200], lastPlayed: 2 } });
  await library.upsertBook({ id: "o", title: "Other Book", files: [{}], progress: { position: 60, duration: 600, lastPlayed: 1 } });
  mockSnapshot.current = { ...mockSnapshot.current, book: null };
  await render(<SearchScreen nav={nav} />);
  const clear = screen.queryByLabelText("Clear search"); // results kept from an earlier test
  if (clear) await fireEvent.press(clear);
  expect(await screen.findByText("CONTINUE LISTENING")).toBeTruthy();
  expect(screen.getByText("75% · 10m left · part 2 of 2")).toBeTruthy();
  expect(screen.getByText("Also listening to")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Resume Hero Book"));
  expect(player.resumeOrLoad).toHaveBeenCalledWith(expect.objectContaining({ id: "h" }));
  expect(nav.navigate).not.toHaveBeenCalledWith("player"); // resumed in place
});

test("settings: back up via the share sheet, restore by pasting", async () => {
  const { Share } = require("react-native");
  const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" });
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  await library.upsertBook({ id: "bk", title: "Backed Up", files: [], progress: { position: 77, lastPlayed: 5 } });
  await render(<SettingsScreen nav={nav} />);
  await fireEvent.press(await screen.findByText("Back up library…"));
  await waitFor(() => expect(share).toHaveBeenCalled());
  const text = share.mock.calls[0][0].message;
  expect(JSON.parse(text).books.map((b) => b.id)).toContain("bk");
  await library.removeBook("bk");
  await fireEvent.press(screen.getByText("Restore from a backup…"));
  await fireEvent.changeText(screen.getByPlaceholderText('{"format":"bustaudio-backup", …}'), text);
  await fireEvent.press(screen.getByText("Restore"));
  await waitFor(() => expect(alert).toHaveBeenCalledWith("Backup restored", expect.stringContaining("1 book added")));
  expect((await library.getBook("bk")).progress.position).toBe(77);
  share.mockRestore();
  alert.mockRestore();
});

test("a big jump in the player can be undone", async () => {
  await render(<PlayerScreen nav={nav} />);
  await screen.findAllByText("The Red-Headed League");
  await fireEvent.press(await screen.findByLabelText("Open chapters"));
  await fireEvent.press(screen.getByText("A Case of Identity"));
  await waitFor(() => expect(player.seekTo).toHaveBeenCalledWith(8049));
  await fireEvent.press(await screen.findByText("↶ Back to 1:06:40"));
  expect(player.seekTo).toHaveBeenLastCalledWith(4000);
  expect(screen.queryByText("↶ Back to 1:06:40")).toBeNull();
  // A nudge of the slider isn't a "jump".
  await fireEvent(screen.getByTestId("slider"), "slidingComplete", 4030);
  expect(screen.queryByText(/↶ Back to/)).toBeNull();
});

test("a book can be saved for later from its page", async () => {
  api.getStreams.mockResolvedValueOnce({ ready: false, status: "Downloading on TorBox (5%).", streams: [] });
  api.getDetails.mockResolvedValueOnce({ description: "A tale.", genre: "Fantasy" });
  await render(<BookScreen nav={nav} params={{ item: { id: "later", title: "Later Book", author: "Someone" } }} />);
  await fireEvent.press(await screen.findByLabelText("Add to Want to Listen"));
  expect(await screen.findByText("✓ In Want to Listen")).toBeTruthy();
  expect(await library.getBook("later")).toMatchObject({ title: "Later Book", saved: true });
  await waitFor(async () => expect(await library.getSavedDetails("later")).toMatchObject({ description: "A tale." }));
  await fireEvent.press(screen.getByLabelText("Remove from Want to Listen"));
  expect(await screen.findByText("+ Want to Listen")).toBeTruthy();
  expect(await library.getBook("later")).toBeNull();
});

test("saved books wait in the Library and on Home", async () => {
  await library.setSaved({ id: "w1", title: "Saved One" }, true);
  await render(<LibraryScreen nav={nav} />);
  expect((await screen.findAllByText("Want to Listen")).length).toBeGreaterThan(0);
  expect(screen.getByText("Saved today")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("More actions for Saved One"));
  await fireEvent.press(screen.getByText("Remove from Want to Listen"));
  await waitFor(() => expect(screen.queryByText("Saved One")).toBeNull());
  expect(await library.getBook("w1")).toBeNull();
});

test("home shows a Want to listen shelf", async () => {
  await library.setSaved({ id: "w2", title: "Shelf Book" }, true);
  mockSnapshot.current = { ...mockSnapshot.current, book: null };
  await render(<SearchScreen nav={nav} />);
  const clear = screen.queryByLabelText("Clear search"); // results kept from an earlier test
  if (clear) await fireEvent.press(clear);
  expect(await screen.findByText("Want to listen")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Shelf Book, saved for later"));
  expect(nav.navigate).toHaveBeenCalledWith("book", { item: expect.objectContaining({ id: "w2" }) });
});

test("listening stats: today against a goal, recent days and finished books", async () => {
  const { dayKey } = require("../stats");
  const { getSettings } = require("../settings");
  const StatsScreen = require("../../screens/StatsScreen").default;
  await AsyncStorage.setItem("bustaudio_listening", JSON.stringify({ days: { [dayKey(Date.now())]: 1200 } }));
  await library.upsertBook({ id: "f", title: "Done Book", author: "Writer", files: [], progress: { finished: true, position: 10, lastPlayed: Date.now() } });
  await setSetting("dailyGoal", 30);
  await render(<StatsScreen nav={nav} />);
  expect(await screen.findByText("10m to go · goal 30 min a day")).toBeTruthy();
  expect(await screen.findByText("Done Book")).toBeTruthy();
  expect(screen.getByText("1 this year")).toBeTruthy();
  expect(screen.getByLabelText(/^Last 2 weeks: .*20m$/)).toBeTruthy();
  await fireEvent.press(screen.getByText("15 min"));
  expect(await screen.findByText("Daily goal reached 🎉")).toBeTruthy();
  await fireEvent.press(screen.getByText("Off"));
  expect(getSettings().dailyGoal).toBe(0);
});

test("the chapter list shows each chapter's length", async () => {
  await render(<PlayerScreen nav={nav} />);
  await screen.findAllByText("The Red-Headed League");
  await fireEvent.press(screen.getByLabelText("Open chapters"));
  // Chapters 1 and 3 are both about 66 minutes; chapter 2 is playing.
  expect(screen.getAllByText("1h 6m")).toHaveLength(2);
});

test("all bookmarks: grouped by book, play from one, share or delete", async () => {
  const { Share } = require("react-native");
  const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" });
  const BookmarksScreen = require("../../screens/BookmarksScreen").default;
  await library.upsertBook({
    id: "bm", title: "Marked Book", author: "Author", files: [{ url: "https://cdn/a" }],
    bookmarks: [{ position: 125, trackIndex: 0, createdAt: 1, note: "Great line" }, { position: 30, trackIndex: 0, createdAt: 2 }],
  });
  await render(<BookmarksScreen nav={nav} />);
  expect(await screen.findByText("Marked Book")).toBeTruthy();
  expect(screen.getByText("Great line")).toBeTruthy();
  await fireEvent.press(screen.getByText("2:05"));
  await waitFor(() => expect(player.playFrom).toHaveBeenCalledWith(expect.objectContaining({ id: "bm" }), 0, 125));
  expect(nav.navigate).toHaveBeenCalledWith("player");
  await fireEvent.press(screen.getByLabelText("Share bookmarks from Marked Book"));
  expect(share.mock.calls[0][0].message).toContain("• 2:05 — Great line");
  await fireEvent.press(screen.getByText("With notes"));
  expect(screen.queryByText("0:30")).toBeNull();
  await fireEvent.press(screen.getByText("With notes"));
  await fireEvent.press(screen.getAllByLabelText("Delete bookmark")[0]);
  await waitFor(async () => expect((await library.getBook("bm")).bookmarks).toHaveLength(1));
  share.mockRestore();
});

test("car mode: big controls step chapters and drop bookmarks", async () => {
  const CarScreen = require("../../screens/CarScreen").default;
  await library.upsertBook({ ...m4b });
  await render(<CarScreen nav={nav} />);
  expect(await screen.findByText("The Red-Headed League")).toBeTruthy();
  expect(screen.getByText("1h 7m left in chapter")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Next chapter"));
  expect(player.seekTo).toHaveBeenCalledWith(8049);
  await fireEvent.press(screen.getByLabelText("Previous chapter"));
  expect(player.seekTo).toHaveBeenLastCalledWith(3983);
  await fireEvent.press(screen.getByLabelText("Add a bookmark here"));
  expect(await screen.findByText("Bookmarked ✓")).toBeTruthy();
  expect((await library.getBook("book")).bookmarks).toEqual([expect.objectContaining({ position: 4000, trackIndex: 0 })]);
});

test("library sections fold away and remember it; bookmarks are a tap away", async () => {
  await library.upsertBook({ id: "f1", title: "Finished One", files: [], progress: { finished: true, position: 9, lastPlayed: 1 }, bookmarks: [{ position: 3, trackIndex: 0, createdAt: 1 }] });
  await render(<LibraryScreen nav={nav} />);
  expect(await screen.findByText("Finished One")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Finished"));
  await waitFor(() => expect(screen.queryByText("Finished One")).toBeNull());
  expect(screen.getByText("Finished · 1")).toBeTruthy();
  expect(require("../settings").getSettings().libraryCollapsed).toEqual(["finished"]);
  await fireEvent.press(screen.getByLabelText("Finished, 1 hidden"));
  expect(await screen.findByText("Finished One")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("All bookmarks (1)"));
  expect(nav.navigate).toHaveBeenCalledWith("bookmarks");
});

test("home greets you with today's listening against your goal", async () => {
  const { dayKey } = require("../stats");
  await AsyncStorage.setItem("bustaudio_listening", JSON.stringify({ days: { [dayKey(Date.now())]: 1200 } }));
  await setSetting("dailyGoal", 30);
  mockSnapshot.current = { ...mockSnapshot.current, book: null };
  await render(<SearchScreen nav={{ ...nav, depth: 1 }} />);
  expect(await screen.findByText(/^(Good (morning|afternoon|evening)|Late-night listening)$/)).toBeTruthy();
  expect(await screen.findByText(/20m of 30m today/)).toBeTruthy();
  await fireEvent.press(screen.getByText(/20m of 30m today/));
  expect(nav.navigate).toHaveBeenCalledWith("stats");
  await act(async () => { await setSetting("dailyGoal", 0); });
});

test("search results can be narrowed to one format", async () => {
  api.search.mockResolvedValueOnce([
    { id: "a", title: "Dune", format: "M4B" }, { id: "b", title: "Children of Dune", format: "mp3" }, { id: "c", title: "Dune Messiah", format: "M4B" },
  ]);
  await render(<SearchScreen nav={nav} />);
  await fireEvent.changeText(screen.getByPlaceholderText("Search audiobooks…"), "dune");
  await fireEvent(screen.getByPlaceholderText("Search audiobooks…"), "submitEditing");
  expect(await screen.findByText("Children of Dune")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Only M4B"));
  expect(screen.queryByText("Children of Dune")).toBeNull();
  expect(screen.getByText("Dune Messiah")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Only M4B"));
  expect(screen.getByText("Children of Dune")).toBeTruthy();
});

test("the library can show a grid of covers", async () => {
  await library.upsertBook({ id: "g1", title: "Grid Book", files: [{}], progress: { position: 300, duration: 600, trackIndex: 0, lastPlayed: 3 } });
  await render(<LibraryScreen nav={nav} />);
  await fireEvent.press(await screen.findByLabelText("Show as a grid of covers"));
  expect(await screen.findByLabelText("Grid Book, 50% listened")).toBeTruthy();
  await fireEvent(screen.getByLabelText("Grid Book, 50% listened"), "longPress");
  expect(await screen.findByText("Play from the beginning")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Show as a list"));
  expect(await screen.findByLabelText("More actions for Grid Book")).toBeTruthy();
});

test("settings: picking an accent colour offers a restart to apply it", async () => {
  await render(<SettingsScreen nav={nav} />);
  await fireEvent.press(await screen.findByLabelText("Blue accent"));
  expect(await screen.findByText("Restart the app to apply Blue")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Violet accent"));
  expect(screen.queryByText(/Restart the app to apply/)).toBeNull();
});

test("time spent in a book shows on its page and in the stats", async () => {
  await AsyncStorage.setItem("bustaudio_listening", JSON.stringify({ days: {}, books: { dl: 7500, gone: 99999 } }));
  await library.upsertBook({ id: "dl", title: "Downloaded Book", author: "Writer", downloaded: true, files: [{ uri: "file:///x/a.m4b" }] });
  await render(<BookScreen nav={nav} params={{ item: { id: "dl", title: "Downloaded Book" } }} />);
  expect(await screen.findByText("2h 5m listened")).toBeTruthy();
});

test("the stats list the books you've listened to most", async () => {
  const StatsScreen = require("../../screens/StatsScreen").default;
  await AsyncStorage.setItem("bustaudio_listening", JSON.stringify({ days: {}, books: { a: 600, b: 7500, gone: 99999 } }));
  await library.upsertBook({ id: "a", title: "Short One", files: [] });
  await library.upsertBook({ id: "b", title: "Long One", files: [] });
  await render(<StatsScreen nav={nav} />);
  expect(await screen.findByText("Most listened")).toBeTruthy();
  expect(await screen.findByText("2h 5m")).toBeTruthy();
  expect(screen.getByText("10m")).toBeTruthy();
  // Most first; books no longer in the library are left out.
  const titles = screen.getAllByText(/^(Short One|Long One)$/).map((n) => n.props.children);
  expect(titles).toEqual(["Long One", "Short One"]);
});

test("settings: what's new can be opened again", async () => {
  await render(<SettingsScreen nav={nav} />);
  await fireEvent.press(await screen.findByText("What's new"));
  expect(await screen.findByText("Car mode")).toBeTruthy();
  await fireEvent.press(screen.getByText("Got it"));
  await waitFor(() => expect(screen.queryByText("Car mode")).toBeNull());
});

test("the end of a book asks for a rating and suggests what's next", async () => {
  await library.upsertBook({ ...m4b, progress: { finished: true, position: 11990 } });
  await library.setSaved({ id: "next", title: "Next Read" }, true);
  mockSnapshot.current = { ...mockSnapshot.current, status: "ended", intent: "stopped" };
  await render(<PlayerScreen nav={nav} />);
  await fireEvent.press(await screen.findByLabelText("4 stars"));
  await waitFor(async () => expect((await library.getBook("book")).rating).toBe(4));
  await fireEvent.press(await screen.findByLabelText("Up next: Next Read"));
  expect(nav.navigate).toHaveBeenCalledWith("book", { item: expect.objectContaining({ id: "next" }) });
});

test("finished books can be rated from the library", async () => {
  await library.upsertBook({ id: "r1", title: "Rated Book", files: [], progress: { finished: true, position: 9, lastPlayed: 1 } });
  await render(<LibraryScreen nav={nav} />);
  await fireEvent.press(await screen.findByLabelText("More actions for Rated Book"));
  await fireEvent.press(screen.getByText("Rate this book"));
  await fireEvent.press(await screen.findByLabelText("5 stars"));
  expect(await screen.findByText(/★★★★★ · Finished/)).toBeTruthy();
  expect((await library.getBook("r1")).rating).toBe(5);
});

test("settings: downloads by size, biggest first, each deletable", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation((title, message, buttons) => buttons[1].onPress());
  downloads.downloadsSizeBytes.mockResolvedValue(3_000_000_000);
  await library.upsertBook({ id: "big", title: "Big Book", downloaded: true, files: [{ uri: "file:///b" }], progress: { position: 50 } });
  downloads.downloadSizes.mockResolvedValue([
    { entry: { id: "big", title: "Big Book" }, bytes: 2_000_000_000 },
    { entry: { id: "small", title: "Small Book", progress: { finished: true } }, bytes: 50_000_000 },
  ]);
  await render(<SettingsScreen nav={nav} />);
  await fireEvent.press(await screen.findByText("Manage downloads ›"));
  expect(await screen.findByText("1.9 GB")).toBeTruthy();
  expect(screen.getByText("48 MB · finished")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Delete download of Big Book"));
  await waitFor(() => expect(screen.queryByText("Big Book")).toBeNull());
  expect(downloads.deleteDownload).toHaveBeenCalledWith("big");
  expect(await library.getBook("big")).toMatchObject({ files: [], progress: { position: 50 } });
  downloads.downloadsSizeBytes.mockResolvedValue(0);
  alert.mockRestore();
});

test("a book page estimates how many days the rest takes at your pace", async () => {
  const { dayKey } = require("../stats");
  // 30 minutes a day for the last 30 days.
  const days = {};
  for (let i = 0; i < 30; i++) days[dayKey(Date.now() - i * 86_400_000)] = 1800;
  await AsyncStorage.setItem("bustaudio_listening", JSON.stringify({ days }));
  await library.upsertBook({
    id: "p", title: "Paced Book", downloaded: true, files: [{ uri: "file:///p.m4b" }],
    progress: { position: 3600, duration: 18000, trackIndex: 0, rate: 1 },
  });
  await render(<BookScreen nav={nav} params={{ item: { id: "p", title: "Paced Book" } }} />);
  expect(await screen.findByText("20% · 4h left · ~8 days at your pace")).toBeTruthy();
});

test("tapping the elapsed time jumps to a typed time", async () => {
  await render(<PlayerScreen nav={nav} />);
  await screen.findAllByText("The Red-Headed League");
  await fireEvent.press(screen.getByLabelText("Go to a time"));
  const input = await screen.findByPlaceholderText("1:23:45");
  await fireEvent.changeText(input, "soon");
  await fireEvent.press(screen.getByText("Go"));
  expect(screen.getByText(/Type a time like/)).toBeTruthy();
  await fireEvent.changeText(input, "9:00:00");
  await fireEvent.press(screen.getByText("Go"));
  expect(screen.getByText("That's past the end (3:20:00).")).toBeTruthy();
  await fireEvent.changeText(input, "2:00:00");
  await fireEvent.press(screen.getByText("Go"));
  expect(player.seekTo).toHaveBeenCalledWith(7200);
  expect(await screen.findByText("↶ Back to 1:06:40")).toBeTruthy();
});

test("long chapter lists can be searched", async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ start: i * 400, title: i === 16 ? "The Final Problem" : `Chapter ${i + 1}` }));
  chaptersService.embeddedChapters.mockResolvedValue(many);
  await render(<PlayerScreen nav={nav} />);
  await fireEvent.press((await screen.findAllByText("Chapter 11"))[0]); // the subtitle opens the sheet
  await fireEvent.changeText(await screen.findByPlaceholderText("Find a chapter"), "final");
  // Long lists live only in the sheet; filtering removes non-matches.
  expect(screen.getAllByText("The Final Problem")).toHaveLength(1);
  expect(screen.queryByText("Chapter 12")).toBeNull();
});

test("a book page lists its contents to start from any chapter or part", async () => {
  const { chapterKey, CHAPTER_PARSER_VERSION } = require("../chapters/index");
  const file = { uri: "file:///x/Book.m4b", filename: "Book.m4b" };
  await library.upsertBook({ id: "toc", title: "Contents Book", downloaded: true, files: [file], progress: { position: 4000, trackIndex: 0 } });
  await library.saveEmbeddedChapters("toc", chapterKey(file, 0), { v: CHAPTER_PARSER_VERSION, chapters: CHAPTERS });
  await render(<BookScreen nav={nav} params={{ item: { id: "toc", title: "Contents Book" } }} />);
  expect(await screen.findByText("Contents · 3 chapters")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Play from A Case of Identity"));
  await waitFor(() => expect(player.playFrom).toHaveBeenCalledWith(expect.objectContaining({ id: "toc" }), 0, 8049));
  expect(nav.navigate).toHaveBeenCalledWith("player");
});

test("a multi-part book being streamed lists its parts", async () => {
  api.getStreams.mockResolvedValueOnce({ ready: true, streams: [1, 2, 3].map((n) => ({ title: `Part ${n} of the tale`, url: `https://cdn/${n}`, filename: `${n}.mp3` })) });
  await render(<BookScreen nav={nav} params={{ item: { id: "parts", title: "Parted" } }} />);
  expect(await screen.findByText("Contents · 3 parts")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Play from Part 2 of the tale"));
  await waitFor(() => expect(player.playFrom).toHaveBeenCalledWith(expect.objectContaining({ id: "parts", files: expect.any(Array) }), 1, 0));
});

const DCC_SERIES = {
  name: "Dungeon Crawler Carl", position: "1", total: 3,
  books: [
    { position: "1", title: "Dungeon Crawler Carl", search: "Dungeon Crawler Carl", current: true, upcoming: false },
    { position: "2", title: "Carl's Doomsday Scenario", search: "Carl's Doomsday Scenario", upcoming: false },
    { position: "8", title: "A Parade of Horribles", search: "A Parade of Horribles", upcoming: true, released: "2099-05-12" },
  ],
  next: { position: "2", title: "Carl's Doomsday Scenario", search: "Carl's Doomsday Scenario", upcoming: false },
};

test("a book page shows its series, and finds the books you don't have", async () => {
  api.getSeries.mockResolvedValueOnce(DCC_SERIES);
  await render(<BookScreen nav={nav} params={{ item: { id: "dcc1", title: "Dungeon Crawler Carl - Matt Dinniman" } }} />);
  expect(await screen.findByText("Dungeon Crawler Carl · Book 1 of 3")).toBeTruthy();
  expect(screen.getByText("This book")).toBeTruthy();
  expect(screen.getByText("Coming 12 May 2099")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Book 2: Carl's Doomsday Scenario"));
  expect(nav.navigate).toHaveBeenCalledWith("search", { query: "Carl's Doomsday Scenario" });
});

test("finishing a series book suggests the next one, on the player and on Home", async () => {
  api.getSeries.mockResolvedValue(DCC_SERIES);
  await library.upsertBook({ ...m4b, title: "Dungeon Crawler Carl - Matt Dinniman", progress: { finished: true, position: 11990, lastPlayed: 5 } });
  mockSnapshot.current = { ...mockSnapshot.current, status: "ended", intent: "stopped" };
  await render(<PlayerScreen nav={nav} />);
  await fireEvent.press(await screen.findByLabelText("Next in series: #2 Carl's Doomsday Scenario"));
  expect(nav.navigate).toHaveBeenCalledWith("search", { query: "Carl's Doomsday Scenario" });
  await screen.unmount();

  mockSnapshot.current = { ...mockSnapshot.current, book: null, status: "paused" };
  await render(<SearchScreen nav={nav} />);
  const clear = screen.queryByLabelText("Clear search"); // results kept from an earlier test
  if (clear) await fireEvent.press(clear);
  expect(await screen.findByText("Continue the series")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Next in Dungeon Crawler Carl: book 2, Carl's Doomsday Scenario"));
  await waitFor(() => expect(api.search).toHaveBeenCalledWith("Carl's Doomsday Scenario", 1));
  api.getSeries.mockResolvedValue(null);
});

test("a stalled upload says so and offers to find another", async () => {
  api.getStreams.mockResolvedValueOnce({ ready: false, status: "Stalled on TorBox (0%): nobody is sharing this upload right now. Try another search result, or check back later.", streams: [] });
  await render(<BookScreen nav={nav} params={{ item: { id: "stuck", title: "Dune - Frank Herbert [M4B]" } }} />);
  expect(await screen.findByText(/This upload isn't moving/)).toBeTruthy();
  await fireEvent.press(screen.getByText("Find another upload"));
  expect(nav.navigate).toHaveBeenCalledWith("search", { query: "Dune" });
});

test("a book TorBox is fetching can download by itself when ready", async () => {
  const waiting = require("../waiting");
  api.getStreams.mockResolvedValue({ ready: false, status: "Downloading on TorBox (12%). Try again shortly.", streams: [] });
  await render(<BookScreen nav={nav} params={{ item: { id: "later2", title: "Patient Book", author: "A" } }} />);
  await fireEvent.press(await screen.findByText("Download when ready"));
  expect(await screen.findByText("✓ Downloads by itself when TorBox has it")).toBeTruthy();
  await screen.unmount();

  await render(<LibraryScreen nav={nav} />);
  expect(await screen.findByText("Waiting on TorBox")).toBeTruthy();
  expect(screen.getByText("Downloading on TorBox (12%). Try again shortly.")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Stop waiting for Patient Book"));
  await waitFor(() => expect(screen.queryByText("Waiting on TorBox")).toBeNull());
  api.getStreams.mockResolvedValue({ ready: true, streams: [] });
  await waiting.stopWaiting("later2");
});

test("series show on Library rows and above the player's title", async () => {
  const { seriesKey } = require("../library");
  await library.upsertBook({ id: "s2", title: "Carl's Doomsday Scenario", author: "Matt Dinniman", files: [{}], progress: { position: 60, duration: 600, lastPlayed: 9 } });
  await AsyncStorage.setItem(seriesKey("s2"), JSON.stringify({ at: Date.now(), series: { ...DCC_SERIES, position: "2" } }));
  await render(<LibraryScreen nav={nav} />);
  expect(await screen.findByText("Matt Dinniman · Dungeon Crawler Carl #2")).toBeTruthy();
  await screen.unmount();

  api.getSeries.mockResolvedValueOnce({ ...DCC_SERIES, position: "1" });
  await render(<PlayerScreen nav={nav} />);
  expect(await screen.findByText("Dungeon Crawler Carl · Book 1")).toBeTruthy();
});

test("uploads of the same book share a row, led by an instant one", async () => {
  api.search.mockResolvedValueOnce([
    { id: "u1", title: "Red Rising", author: "Pierce Brown", format: "MP3", sizeText: "300 MB" },
    { id: "u2", title: "Red Rising (Unabridged)", author: "Pierce Brown", format: "M4B", sizeText: "450 MB", cached: true },
    { id: "u3", title: "Golden Son", author: "Pierce Brown" },
    { id: "u4", title: "Red Rising", author: "Pierce Brown", format: "MP3", sizeText: "280 MB" },
  ]);
  await render(<SearchScreen nav={nav} />);
  await fireEvent.changeText(screen.getByPlaceholderText("Search audiobooks…"), "red rising");
  await fireEvent(screen.getByPlaceholderText("Search audiobooks…"), "submitEditing");
  expect(await screen.findByText("+2 more uploads")).toBeTruthy();
  expect(screen.getByText("Red Rising (Unabridged)")).toBeTruthy(); // the instant one leads
  expect(screen.queryByText("MP3 · 300 MB")).toBeNull();
  await fireEvent.press(screen.getByText("+2 more uploads"));
  expect(screen.getByText("MP3 · 300 MB")).toBeTruthy();
  expect(screen.getByText("MP3 · 280 MB")).toBeTruthy();
  await fireEvent.press(screen.getByText("Hide other uploads"));
  expect(screen.queryByText("MP3 · 300 MB")).toBeNull();
  expect(screen.getByText("Golden Son")).toBeTruthy();
});

test("home suggests new books in your series and books like your last one", async () => {
  api.getSeries.mockResolvedValue({ ...DCC_SERIES, books: [...DCC_SERIES.books.slice(0, 2), { position: "9", title: "Future Book", search: "Future Book", released: "2099-01-01", upcoming: true }] });
  api.getSimilar.mockResolvedValue({ because: "Dungeon Crawler Carl", books: [{ title: "The Primal Hunter", search: "The Primal Hunter", author: "Zogarth", kind: "similar" }] });
  await library.upsertBook({ id: "dccA", title: "Dungeon Crawler Carl - Matt Dinniman", files: [], progress: { position: 600, lastPlayed: 7 } });
  mockSnapshot.current = { ...mockSnapshot.current, book: null };
  await render(<SearchScreen nav={nav} />);
  const clear = screen.queryByLabelText("Clear search"); // results kept from an earlier test
  if (clear) await fireEvent.press(clear);
  expect(await screen.findByText("New in your series")).toBeTruthy();
  expect(screen.getByText("Coming 1 Jan 2099")).toBeTruthy();
  expect(await screen.findByText("Because you listened to Dungeon Crawler Carl")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("The Primal Hunter by Zogarth. Search for it"));
  await waitFor(() => expect(api.search).toHaveBeenCalledWith("The Primal Hunter", 1));
  api.getSeries.mockResolvedValue(null);
  api.getSimilar.mockResolvedValue(null);
});

test("the player exposes chapters and bookmarks without long lists under its controls", async () => {
  await library.upsertBook({ ...m4b, bookmarks: [{ position: 20, trackIndex: 0, createdAt: 8, note: "Remember this" }] });
  await render(<PlayerScreen nav={nav} />);
  await screen.findByLabelText("Open chapters");
  expect(screen.queryByText("A Scandal in Bohemia")).toBeNull();
  await fireEvent.press(screen.getByLabelText("Open chapters"));
  expect(await screen.findByText("A Scandal in Bohemia")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Close Chapters"));
  await fireEvent.press(screen.getByLabelText("Open bookmarks"));
  expect(await screen.findByText("Remember this")).toBeTruthy();
  expect(screen.getByLabelText("Delete bookmark at 0:20")).toBeTruthy();
});

test("the seek control describes its scope and elapsed time to assistive technology", async () => {
  await render(<PlayerScreen nav={nav} />);
  expect(await screen.findByLabelText("Position in chapter")).toBeTruthy();
  expect(screen.getByTestId("slider").props.accessibilityValue.text).toContain("0:17");
  await fireEvent.press(screen.getByText("Whole book"));
  expect(screen.getByLabelText("Position in book")).toBeTruthy();
});

test("library filters isolate offline and saved books without duplicate shelves", async () => {
  await library.upsertBook({ id: "offline", title: "Offline Story", downloaded: true, files: [{ uri: "file:///x" }], progress: { position: 50, duration: 100 } });
  await library.setSaved({ id: "saved", title: "For Later" }, true);
  await render(<LibraryScreen nav={nav} />);
  await fireEvent.press(await screen.findByLabelText("Library view: Downloaded"));
  expect(screen.getAllByText("Offline Story")).toHaveLength(1);
  expect(screen.queryByText("For Later")).toBeNull();
  await fireEvent.press(screen.getByLabelText("Library view: Want to Listen"));
  expect(screen.getByText("For Later")).toBeTruthy();
  expect(screen.queryByText("Offline Story")).toBeNull();
  await fireEvent.press(screen.getByLabelText("Library view: Transfers"));
  expect(screen.getByText("No downloads in progress")).toBeTruthy();
  await fireEvent.press(screen.getByText("Find a book"));
  expect(nav.reset).toHaveBeenCalledWith("search");
});

test("connection testing reports an invalid key and can be retried", async () => {
  api.health.mockResolvedValueOnce({ ok: true, torboxKeyValid: false }).mockResolvedValueOnce({ ok: true, torboxKeyValid: true });
  await render(<SettingsScreen nav={nav} />);
  await fireEvent.press(await screen.findByText("Test connection"));
  expect(await screen.findByText("Server reached, but the TorBox key is invalid. Replace your install link.")).toBeTruthy();
  await fireEvent.press(screen.getByText("Test connection"));
  expect(await screen.findByText("Connected. Your server and TorBox key are ready.")).toBeTruthy();
});

test("the player exposes the current part title before opening the parts sheet", async () => {
  chaptersService.embeddedChapters.mockResolvedValue(null);
  const partTitle = "Chapter sixteen: The long road through the forgotten mountain kingdom";
  mockSnapshot.current = { ...mockSnapshot.current, book: { ...m4b, files: [
    { ...m4b.files[0], title: partTitle },
    { filename: "next.mp3", title: "The next morning", url: "https://cdn/next", size: 1000 },
  ] } };
  await render(<PlayerScreen nav={nav} />);
  expect(await screen.findByText(partTitle)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Open chapters"));
  expect(await screen.findByText("The next morning")).toBeTruthy();
});

test("Downloaded retains finished offline books and excludes finished streams", async () => {
  await library.upsertBook({ id: "kept", title: "Kept Offline", downloaded: true, files: [{ uri: "file:///kept" }], progress: { finished: true, position: 100 } });
  await library.upsertBook({ id: "stream", title: "Finished Stream", files: [{ url: "https://cdn/book" }], progress: { finished: true, position: 100 } });
  await render(<LibraryScreen nav={nav} />);
  await fireEvent.press(await screen.findByLabelText("Library view: Downloaded"));
  expect(screen.getAllByText("Kept Offline")).toHaveLength(1);
  expect(screen.queryByText("Finished Stream")).toBeNull();
  expect(screen.queryByText("No offline books yet")).toBeNull();
});
