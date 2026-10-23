/* global test, beforeEach */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildBackup, restoreBackup } from "../backup";
import { getBook, getLibrary, setSaved, upsertBook } from "../library";
import { getSettings, setSetting } from "../settings";

beforeEach(async () => {
  await AsyncStorage.clear();
  await setSetting("speed", 1);
});

async function seedPhone() {
  await upsertBook({
    id: "dune", title: "Dune", author: "Frank Herbert", poster: "https://x/dune.jpg", downloaded: true, storageDir: "d",
    files: [{ uri: "file:///secret/path/dune.m4b" }],
    progress: { position: 3600, trackIndex: 0, duration: 72000, finished: false, lastPlayed: 100, rate: 1.4 },
    bookmarks: [{ position: 120, trackIndex: 0, createdAt: 1, note: "Fear is the mind-killer" }],
  });
  await upsertBook({ id: "hobbit", title: "The Hobbit", files: [{ url: "https://torbox/signed-link" }], progress: { position: 10, finished: true, lastPlayed: 50 } });
  await AsyncStorage.setItem("bustaudio_listening", JSON.stringify({ days: { "2026-10-20": 1800 }, books: { dune: 1700 } }));
  await setSetting("speed", 1.25);
}

test("a backup carries progress, bookmarks, speeds, stats and settings — never files or links", async () => {
  await seedPhone();
  const text = await buildBackup(1234);
  expect(text).not.toContain("file://");
  expect(text).not.toContain("signed-link");
  const data = JSON.parse(text);
  expect(data).toMatchObject({ format: "bustaudio-backup", version: 1, exportedAt: 1234, listening: { "2026-10-20": 1800 }, settings: { speed: 1.25 } });
  expect(data.books.find((b) => b.id === "dune")).toEqual({
    id: "dune", title: "Dune", author: "Frank Herbert", poster: "https://x/dune.jpg",
    progress: { position: 3600, trackIndex: 0, duration: 72000, finished: false, lastPlayed: 100, rate: 1.4 },
    bookmarks: [{ position: 120, trackIndex: 0, createdAt: 1, note: "Fear is the mind-killer" }],
  });
});

test("restoring on a new phone brings everything back; restoring twice changes nothing", async () => {
  await seedPhone();
  const text = await buildBackup();
  await AsyncStorage.clear();
  await setSetting("speed", 1);
  expect(await restoreBackup(text)).toEqual({ added: 2, updated: 0 });
  const dune = await getBook("dune");
  expect(dune).toMatchObject({ title: "Dune", files: [], progress: { position: 3600, rate: 1.4 }, bookmarks: [{ note: "Fear is the mind-killer" }] });
  expect(dune.downloaded).toBeUndefined();
  expect(getSettings().speed).toBe(1.25);
  expect(JSON.parse(await AsyncStorage.getItem("bustaudio_listening")).days).toEqual({ "2026-10-20": 1800 });
  expect(JSON.parse(await AsyncStorage.getItem("bustaudio_listening")).books).toEqual({ dune: 1700 });
  const before = JSON.stringify(await getLibrary());
  expect(await restoreBackup(text)).toEqual({ added: 0, updated: 0 });
  expect(JSON.stringify(await getLibrary())).toBe(before);
  expect(JSON.parse(await AsyncStorage.getItem("bustaudio_listening")).days).toEqual({ "2026-10-20": 1800 });
});

test("on a phone already in use, newer progress wins and bookmarks combine", async () => {
  await seedPhone();
  const text = await buildBackup();
  // Meanwhile this phone listened further and added a bookmark of its own.
  await upsertBook({ id: "dune", title: "Dune", progress: { position: 9000, lastPlayed: 500 }, bookmarks: [{ position: 9000, trackIndex: 0, createdAt: 9 }] });
  expect(await restoreBackup(text)).toEqual({ added: 0, updated: 1 });
  const dune = await getBook("dune");
  expect(dune.progress.position).toBe(9000); // ours was newer
  expect(dune.bookmarks.map((m) => m.createdAt)).toEqual([1, 9]);
});

test("Want to Listen survives a backup", async () => {
  await setSaved({ id: "later", title: "Later Book", poster: "https://x/l.jpg" }, true);
  const text = await buildBackup();
  await AsyncStorage.clear();
  expect(await restoreBackup(text)).toEqual({ added: 1, updated: 0 });
  expect(await getBook("later")).toMatchObject({ title: "Later Book", saved: true, files: [] });
  // Already on the phone but not saved there: the save carries over.
  await setSaved({ id: "later" }, false);
  await upsertBook({ id: "later", title: "Later Book", files: [{ url: "https://x" }] });
  expect(await restoreBackup(text)).toEqual({ added: 0, updated: 1 });
  expect((await getBook("later")).saved).toBe(true);
});

test("anything that isn't a backup is refused with a clear message", async () => {
  await expect(restoreBackup("hello")).rejects.toThrow("That isn't a BusTAudio backup");
  await expect(restoreBackup(JSON.stringify({ format: "something-else", books: [] }))).rejects.toThrow("That isn't a BusTAudio backup");
  await expect(restoreBackup(JSON.stringify({ format: "bustaudio-backup", version: 99, books: [] }))).rejects.toThrow("newer app version");
});
