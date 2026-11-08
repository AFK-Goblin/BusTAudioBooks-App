/* global test, beforeEach */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  checkpointAudiobookProgress, continueListening, finishedBooks, getBook, resetProgress, saveEmbeddedChapters,
  setFinished, upsertBook, clearBookDownload, getEmbeddedChapters, saveDetails, getSavedDetails, removeBook, setBookmarkNote,
  setSaved, wantToListen, librarySections,
} from "../library";

beforeEach(() => AsyncStorage.clear());

test('listening shelves include later parts but exclude finished and unstarted books', async () => {
  await upsertBook({ id: 'later', progress: { trackIndex: 2, position: 0, lastPlayed: 30 } });
  await upsertBook({ id: 'first', progress: { trackIndex: 0, position: 60, lastPlayed: 20 } });
  await upsertBook({ id: 'done', progress: { trackIndex: 2, position: 0, finished: true, lastPlayed: 40 } });
  await upsertBook({ id: 'new', saved: true, progress: { trackIndex: 0, position: 0 } });
  await upsertBook({ id: 'empty', progress: {} });
  const sections = await librarySections();
  expect(sections.continueListening.map(b => b.id)).toEqual(['later', 'first']);
  expect(sections.finished.map(b => b.id)).toEqual(['done']);
  expect(sections.wantToListen.map(b => b.id)).toEqual(['new']);
});

test("checkpoints learn each part's duration without forgetting earlier parts", async () => {
  await upsertBook({ id: "b", title: "Book", files: [{}, {}, {}] });
  await checkpointAudiobookProgress("b", { trackIndex: 0, position: 10, duration: 600, finished: false });
  await checkpointAudiobookProgress("b", { trackIndex: 2, position: 5, duration: 900, finished: false });
  await checkpointAudiobookProgress("b", { trackIndex: 2, position: 6, duration: 0, finished: false });
  const { progress } = await getBook("b");
  expect(progress).toMatchObject({ trackIndex: 2, position: 6, trackDurations: [600, null, 900] });
  expect(progress.lastPlayed).toEqual(expect.any(Number));
});

test("marking finished moves a book between Continue Listening and Finished, keeping its place", async () => {
  await upsertBook({ id: "b", title: "Book", files: [{}], progress: { position: 1200, trackIndex: 0 } });
  await setFinished("b", true);
  expect((await finishedBooks()).map((b) => b.id)).toEqual(["b"]);
  expect(await continueListening()).toEqual([]);
  await setFinished("b", false);
  expect((await continueListening()).map((b) => b.id)).toEqual(["b"]);
  expect((await getBook("b")).progress.position).toBe(1200);
});

test("reset returns to the start but keeps learned durations, bookmarks and chapters", async () => {
  await upsertBook({ id: "b", title: "Book", files: [{}], bookmarks: [{ position: 5, trackIndex: 0, createdAt: 1 }],
    progress: { position: 900, trackIndex: 1, trackDurations: [100, 200], finished: false } });
  await saveEmbeddedChapters("b", "0:x.m4b", { v: 1, chapters: null });
  await resetProgress("b");
  const entry = await getBook("b");
  expect(entry.progress).toEqual({ position: 0, trackIndex: 0, finished: false, trackDurations: [100, 200] });
  await upsertBook({ id: "r", title: "R", files: [], progress: { position: 9, rate: 1.5 } });
  await resetProgress("r");
  expect((await getBook("r")).progress).toEqual({ position: 0, trackIndex: 0, finished: false, rate: 1.5 });
  expect(entry.bookmarks).toHaveLength(1);
  expect(await getEmbeddedChapters("b")).toEqual({ "0:x.m4b": { v: 1, chapters: null } });
});

test("per-book metadata stays out of the library blob and leaves with the book", async () => {
  await upsertBook({ id: "b", title: "Book", files: [] });
  await saveDetails("b", { description: "x".repeat(4000), genre: "Fantasy", year: 2001 });
  await saveEmbeddedChapters("b", "0:a.m4b", { v: 2, chapters: [{ start: 0, title: "One" }] });
  await saveDetails("not-in-library", { description: "ignored" });
  expect(JSON.stringify(await getBook("b"))).not.toContain("xxxx");
  expect((await getSavedDetails("b")).genre).toBe("Fantasy");
  expect(await getSavedDetails("not-in-library")).toBeNull();
  await removeBook("b");
  expect(await getSavedDetails("b")).toBeNull();
  expect(await getEmbeddedChapters("b")).toEqual({});
});

test("clearing a download keeps progress but forgets the files and their folder", async () => {
  await upsertBook({ id: "b", title: "Book", downloaded: true, downloadedAt: 1, storageDir: "dir", files: [{ uri: "file:///x" }], progress: { position: 50 } });
  await clearBookDownload("b");
  const entry = await getBook("b");
  expect(entry).toMatchObject({ files: [], progress: { position: 50 } });
  expect(entry.downloaded).toBeUndefined();
  expect(entry.storageDir).toBeUndefined();
});

test("Want to Listen: saving makes a small entry, starting a book moves it on, un-saving tidies up", async () => {
  await setSaved({ id: "w", title: "Wanted", author: "A", poster: "p", cached: true, size: 9 }, true);
  const entry = await getBook("w");
  expect(entry).toMatchObject({ id: "w", title: "Wanted", author: "A", poster: "p", files: [], saved: true });
  expect(entry.cached).toBeUndefined();
  expect((await librarySections()).wantToListen.map((b) => b.id)).toEqual(["w"]);

  await saveDetails("w", { description: "kept offline" });
  await setSaved({ id: "w" }, false);
  expect(await getBook("w")).toBeNull(); // nothing but a title: gone again
  expect(await getSavedDetails("w")).toBeNull();

  // A saved book you've started is in Continue Listening instead, and
  // un-saving it keeps its progress.
  await upsertBook({ id: "s", title: "Started", files: [{ url: "https://x" }], progress: { position: 50 } });
  await setSaved({ id: "s", title: "Started" }, true);
  expect((await getBook("s")).progress.position).toBe(50);
  expect(wantToListen([await getBook("s")])).toEqual([]);
  await setSaved({ id: "s" }, false);
  expect(await getBook("s")).toMatchObject({ progress: { position: 50 } });
  expect((await getBook("s")).saved).toBeUndefined();
});

test("bookmark notes can be added, trimmed and cleared", async () => {
  await upsertBook({ id: "b", title: "Book", files: [], bookmarks: [{ position: 5, trackIndex: 0, createdAt: 1 }, { position: 9, trackIndex: 0, createdAt: 2 }] });
  let marks = await setBookmarkNote("b", 2, "  great line  ");
  expect(marks).toEqual([{ position: 5, trackIndex: 0, createdAt: 1 }, { position: 9, trackIndex: 0, createdAt: 2, note: "great line" }]);
  marks = await setBookmarkNote("b", 2, "");
  expect(marks[1]).toEqual({ position: 9, trackIndex: 0, createdAt: 2 });
});

test("bookmarks read well when shared, and books are listed by their latest bookmark", async () => {
  const { bookmarksText } = require("../bookmarks");
  const { bookmarkedBooks } = require("../library");
  const book = {
    id: "d", title: "Dune", author: "Frank Herbert", files: [{}, {}],
    bookmarks: [{ position: 3723, trackIndex: 1, createdAt: 5, note: "Fear is the mind-killer" }, { position: 65, trackIndex: 0, createdAt: 9 }],
  };
  expect(bookmarksText(book)).toBe(
    "Dune — Frank Herbert\nBookmarks from BusTAudioBooks\n\n• Part 1 · 1:05\n• Part 2 · 1:02:03 — Fear is the mind-killer",
  );
  await upsertBook(book);
  await upsertBook({ id: "h", title: "Hobbit", files: [{}], bookmarks: [{ position: 1, trackIndex: 0, createdAt: 20 }] });
  await upsertBook({ id: "n", title: "No marks", files: [] });
  expect((await bookmarkedBooks()).map((b) => b.id)).toEqual(["h", "d"]);
  expect((await librarySections()).bookmarkCount).toBe(3);
});

test("ratings are 1–5 stars, 0 clears, and they travel in backups", async () => {
  const { setRating } = require("../library");
  const { buildBackup, restoreBackup } = require("../backup");
  await upsertBook({ id: "r", title: "Rated", files: [] });
  expect((await setRating("r", 7)).rating).toBe(5);
  expect((await setRating("r", 3)).rating).toBe(3);
  const text = await buildBackup();
  expect((await setRating("r", 0)).rating).toBeUndefined();
  expect(await restoreBackup(text)).toEqual({ added: 0, updated: 1 });
  expect((await getBook("r")).rating).toBe(3);
});
