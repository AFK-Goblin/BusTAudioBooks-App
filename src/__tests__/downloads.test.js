/* global test, beforeEach */
import AsyncStorage from "@react-native-async-storage/async-storage";

const mockDisk = { dirs: new Set(), deleted: [], files: new Map() };

// Notices start a timer that would outlive the test.
jest.mock("../toast", () => ({ showToast: jest.fn() }));
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  makeDirectoryAsync: jest.fn(async (uri) => { mockDisk.dirs.add(uri); }),
  deleteAsync: jest.fn(async (uri) => { mockDisk.deleted.push(uri); }),
  getInfoAsync: jest.fn(async (uri) => mockDisk.files.has(uri) ? { exists: true, isDirectory: false, size: mockDisk.files.get(uri) } : { exists: false }),
  readDirectoryAsync: jest.fn(async (uri) => {
    const prefix = `${uri}/`;
    return [...mockDisk.dirs].filter((d) => d.startsWith(prefix)).map((d) => d.slice(prefix.length));
  }),
}));

const mockTasks = [];
const mockNative = { hang: false, stopped: [], notificationCancel: false };
jest.mock("@kesha-antonov/react-native-background-downloader", () => ({
  directories: { documents: "/data/docs" },
  setConfig: jest.fn(),
  completeHandler: jest.fn(),
  getExistingDownloadTasks: jest.fn(async () => mockTasks),
  createDownloadTask: jest.fn((options) => {
    const handlers = {};
    const task = {
      id: options.id,
      begin(fn) { handlers.begin = fn; return task; },
      progress(fn) { handlers.progress = fn; return task; },
      done(fn) { handlers.done = fn; return task; },
      error(fn) { handlers.error = fn; return task; },
      start() {
        if (mockNative.notificationCancel) { setTimeout(() => handlers.error?.({ error: "Cancelled", errorCode: -1 }), 0); return; }
        if (mockNative.hang) { setTimeout(() => handlers.progress?.({ bytesDownloaded: 40, bytesTotal: 100 }), 0); return; }
        setTimeout(() => { mockDisk.files.set(`file://${options.destination}`, mockNative.completedSize); handlers.progress?.({ bytesDownloaded: 50, bytesTotal: mockNative.completedSize }); handlers.done?.(); }, 0);
      },
      stop: jest.fn(async () => { mockNative.stopped.push(options.id); }),
    };
    return task;
  }),
}));

jest.mock("../api", () => ({ getStreams: jest.fn() }));

const downloads = require("../downloads");
const api = require("../api");
const library = require("../library");
const native = require("@kesha-antonov/react-native-background-downloader");

const ROOT = "file:///data/docs/bustaudio";
// Hashless Jackett ids: identical for their first 80+ characters.
const longA = `tbab:${"x".repeat(90)}A`;
const longB = `tbab:${"x".repeat(90)}B`;

beforeEach(async () => {
  await AsyncStorage.clear();
  mockDisk.dirs.clear();
  mockDisk.files.clear();
  mockNative.completedSize = 100;
  mockDisk.deleted.length = 0;
  mockTasks.length = 0;
  native.createDownloadTask.mockClear();
  mockNative.hang = false;
  mockNative.notificationCancel = false;
  mockNative.stopped.length = 0;
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("short ids keep their legacy folder; long ids no longer collide", () => {
  expect(downloads.storageDirFor("md:abc")).toBe(downloads.safe("md:abc"));
  expect(downloads.safe(longA)).toBe(downloads.safe(longB));
  expect(downloads.storageDirFor(longA)).not.toBe(downloads.storageDirFor(longB));
  expect(downloads.storageDirFor(longA).length).toBeLessThanOrEqual(80);
});

test("a download records its folder and keeps filename and size on local files", async () => {
  mockNative.completedSize = 1234;
  const entry = await downloads.downloadBook(
    { id: longA, title: "A" },
    [{ title: "Part 1", url: "https://cdn.example/1", filename: "Part 1.mp3", size: 1234 }],
  );
  const dir = downloads.storageDirFor(longA);
  expect(entry.storageDir).toBe(dir);
  expect(entry.files).toEqual([{ title: "Part 1", uri: `file:///data/docs/bustaudio/${dir}/0001-Part_1.mp3`, filename: "Part 1.mp3", size: 1234 }]);
  expect(native.createDownloadTask).toHaveBeenCalledWith(expect.objectContaining({ id: `${dir}-0` }));
});

test("deleteDownload removes the recorded folder, or the one older file URIs point into", async () => {
  await library.upsertBook({ id: "new", title: "New", downloaded: true, storageDir: "new-dir", files: [] });
  await library.upsertBook({ id: "old", title: "Old", downloaded: true, files: [{ uri: `${ROOT}/legacy-dir/one.mp3` }] });
  await downloads.deleteDownload("new");
  await downloads.deleteDownload("old");
  expect(mockDisk.deleted).toEqual([`${ROOT}/new-dir`, `${ROOT}/legacy-dir`]);
});

test("the orphan sweep deletes only folders no entry or pending job owns", async () => {
  ["kept-entry", "legacy-files", "orphan-one", "orphan-two", downloads.safe("job-id")].forEach((d) => mockDisk.dirs.add(`${ROOT}/${d}`));
  await library.upsertBook({ id: "a", title: "A", downloaded: true, storageDir: "kept-entry" });
  await library.upsertBook({ id: "b", title: "B", downloaded: true, files: [{ uri: `${ROOT}/legacy-files/x.mp3` }] });
  await library.upsertBook({ id: "c", title: "C", progress: { position: 10 } });
  await AsyncStorage.setItem("bustaudio_dljobs", JSON.stringify({ "job-id": { book: { id: "job-id" }, files: [] } }));
  const removed = await downloads.sweepOrphanedDownloads();
  expect(removed).toBe(2);
  expect(mockDisk.deleted.sort()).toEqual([`${ROOT}/orphan-one`, `${ROOT}/orphan-two`]);
});

test("a job saved by an older build re-attaches by its legacy task ids", async () => {
  const book = { id: longA, title: "A" };
  await AsyncStorage.setItem("bustaudio_dljobs", JSON.stringify({ [longA]: { book, files: [{ url: "https://cdn.example/1", filename: "a.mp3" }] } }));
  const legacyTaskId = `${downloads.safe(longA)}-0`;
  const attached = { id: legacyTaskId, state: "DONE" };
  mockTasks.push(attached);
  mockDisk.files.set(`${ROOT}/${downloads.safe(longA)}/a.mp3`, 100);
  await downloads.resumePendingDownloads();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(native.createDownloadTask).not.toHaveBeenCalled();
  const entry = await library.getBook(longA);
  expect(entry.storageDir).toBe(downloads.safe(longA));
  expect(entry.downloaded).toBe(true);
});

describe("cancel", () => {
  const store = require("../downloadStore");

  test("stops the transferring file, deletes the partial folder and forgets the job", async () => {
    mockNative.hang = true;
    const seen = [];
    const unsubscribe = store.subscribe((items) => seen.push(items.map((d) => d.id)));
    const done = downloads.downloadBook({ id: "c1", title: "C" }, [{ url: "https://cdn/1", filename: "1.mp3" }, { url: "https://cdn/2", filename: "2.mp3" }]);
    await tick();
    await downloads.cancelDownload("c1");
    await expect(done).rejects.toBeInstanceOf(downloads.DownloadCancelled);
    unsubscribe();
    expect(mockNative.stopped).toEqual(["c1-0"]);
    expect(native.createDownloadTask).toHaveBeenCalledTimes(1); // file 2 never started
    expect(mockDisk.deleted).toContain(`${ROOT}/c1`);
    expect(JSON.parse((await AsyncStorage.getItem("bustaudio_dljobs")) || "{}")).toEqual({});
    expect(seen.at(-1)).toEqual([]); // gone from the Downloading list, not "failed"
    expect(await library.getBook("c1")).toBeNull();
  });

  test("a cancelled book can be downloaded again straight away", async () => {
    mockNative.hang = true;
    const first = downloads.downloadBook({ id: "c2", title: "C" }, [{ url: "https://cdn/1", filename: "1.mp3" }]);
    await tick();
    await downloads.cancelDownload("c2");
    await expect(first).rejects.toBeInstanceOf(downloads.DownloadCancelled);
    mockNative.hang = false;
    const entry = await downloads.downloadBook({ id: "c2", title: "C" }, [{ url: "https://cdn/1", filename: "1.mp3" }]);
    expect(entry.downloaded).toBe(true);
  });

  test("cancelling something that is not running just clears it away", async () => {
    store.startTracking("idle", { title: "Idle", count: 1 });
    store.failTracking("idle", "boom");
    await downloads.cancelDownload("idle");
    let current = [];
    store.subscribe((items) => { current = items; })();
    expect(current.find((d) => d.id === "idle")).toBeUndefined();
  });

  test("starting the same book twice is refused", async () => {
    mockNative.hang = true;
    const first = downloads.downloadBook({ id: "c3", title: "C" }, [{ url: "https://cdn/1" }]);
    await tick();
    await expect(downloads.downloadBook({ id: "c3", title: "C" }, [{ url: "https://cdn/1" }])).rejects.toThrow("already downloading");
    await downloads.cancelDownload("c3");
    await expect(first).rejects.toBeInstanceOf(downloads.DownloadCancelled);
  });
});

test("download progress is for the whole book, by bytes when sizes are known", () => {
  const store = require("../downloadStore");
  let rows = [];
  const unsubscribe = store.subscribe((items) => { rows = items; });
  store.startTracking("p", { title: "P", count: 2, files: [{ size: 300 }, { size: 100 }] });
  store.reportProgress("p", 1, 2, 50, 100);
  expect(rows.find((d) => d.id === "p")).toMatchObject({ pct: 87, bytesDone: 350, bytesTotal: 400 });
  store.startTracking("q", { title: "Q", count: 4, files: [{}, {}, {}, {}] });
  store.reportProgress("q", 1, 4, 50, 100);
  expect(rows.find((d) => d.id === "q").pct).toBe(37);
  unsubscribe();
  store.dismissTracking("p");
  store.dismissTracking("q");
});

describe("comics removal", () => {
  test("drops comic entries, their files, jobs, cache and history — once", async () => {
    mockDisk.dirs.add(`${ROOT}/md-series-ch1`);
    mockDisk.dirs.add(`${ROOT}/book-dir`);
    await library.upsertBook({ id: "comic1", type: "comic", title: "A Comic", downloaded: true, storageDir: "comic-dir", files: [] });
    await library.upsertBook({ id: "md-series-ch1", type: "comic", kind: "chapter", title: "Ch. 1", downloaded: true, files: [{ uri: `${ROOT}/md-series-ch1/p001.jpg` }] });
    await library.upsertBook({ id: "series", type: "comic", provider: "mangadex", title: "Series", progress: { page: 3 } });
    await library.upsertBook({ id: "book", title: "An Audiobook", downloaded: true, storageDir: "book-dir", files: [], progress: { position: 50 } });
    await AsyncStorage.setItem("bustaudio_dljobs", JSON.stringify({ c2: { book: { id: "c2", type: "comic" }, files: [] } }));
    await AsyncStorage.setItem("bustaudio_recent_manga", JSON.stringify(["one piece"]));

    expect(await library.listBooks()).toHaveLength(1); // comics are hidden even before cleanup
    expect(await downloads.removeComicsData()).toBe(3);

    expect(Object.keys(await library.getLibrary())).toEqual(["book"]);
    expect(mockDisk.deleted).toEqual(expect.arrayContaining([`${ROOT}/comic-dir`, `${ROOT}/md-series-ch1`, "file:///cache/bustcomics"]));
    expect(mockDisk.deleted).not.toContain(`${ROOT}/book-dir`);
    expect(JSON.parse(await AsyncStorage.getItem("bustaudio_dljobs"))).toEqual({});
    expect(await AsyncStorage.getItem("bustaudio_recent_manga")).toBeNull();

    // Second launch: nothing to do, nothing touched.
    await library.upsertBook({ id: "late", type: "comic", title: "Never seen" });
    expect(await downloads.removeComicsData()).toBe(0);
    expect((await library.getLibrary()).late).toBeDefined();
  });

  test("pending comic downloads aren't resumed; their native transfers are stopped", async () => {
    const stop = jest.fn();
    mockTasks.push({ id: "cdir-0", state: "DOWNLOADING", stop });
    await AsyncStorage.setItem("bustaudio_dljobs", JSON.stringify({ c3: { book: { id: "c3", type: "comic" }, files: [{ url: "https://cdn/x" }], dir: "cdir" } }));
    await downloads.resumePendingDownloads();
    expect(stop).toHaveBeenCalled();
    expect(native.createDownloadTask).not.toHaveBeenCalled();
    expect(JSON.parse(await AsyncStorage.getItem("bustaudio_dljobs"))).toEqual({});
  });
});

test("storage use adds up every file under the downloads folder", async () => {
  const fsMock = require("expo-file-system/legacy");
  const originals = [fsMock.getInfoAsync.getMockImplementation(), fsMock.readDirectoryAsync.getMockImplementation()];
  const tree = { [`${ROOT}`]: ["a", "b"], [`${ROOT}/a`]: ["1.mp3", "2.mp3"], [`${ROOT}/b`]: ["3.mp3"] };
  const sizes = { [`${ROOT}/a/1.mp3`]: 100, [`${ROOT}/a/2.mp3`]: 200, [`${ROOT}/b/3.mp3`]: 50 };
  fsMock.getInfoAsync.mockImplementation(async (uri) => (tree[uri] ? { exists: true, isDirectory: true } : sizes[uri] ? { exists: true, isDirectory: false, size: sizes[uri] } : { exists: false }));
  fsMock.readDirectoryAsync.mockImplementation(async (uri) => tree[uri] || []);
  try {
    expect(await downloads.downloadsSizeBytes()).toBe(350);
  } finally {
    fsMock.getInfoAsync.mockImplementation(originals[0]);
    fsMock.readDirectoryAsync.mockImplementation(originals[1]);
  }
});

describe("download notifications", () => {
  test("are switched on once, with a Cancel button and a title per part", async () => {
    await downloads.downloadBook({ id: "n1", title: "Dune" }, [{ url: "https://cdn/1", filename: "1.mp3" }, { url: "https://cdn/2", filename: "2.mp3" }]);
    expect(native.setConfig).toHaveBeenCalledTimes(1);
    expect(native.setConfig).toHaveBeenCalledWith(expect.objectContaining({ showNotificationsEnabled: true, showCancelAction: true, showCompletionNotification: false }));
    expect(native.createDownloadTask.mock.calls.map(([o]) => o.metadata.notificationTitle)).toEqual(["Dune — part 1 of 2", "Dune — part 2 of 2"]);
  });

  test("the notification's Cancel button cancels the book like the Library's ✕", async () => {
    mockNative.notificationCancel = true;
    const store = require("../downloadStore");
    let rows = [];
    const unsubscribe = store.subscribe((items) => { rows = items; });
    await expect(downloads.downloadBook({ id: "n2", title: "C" }, [{ url: "https://cdn/1", filename: "1.mp3" }, { url: "https://cdn/2" }]))
      .rejects.toBeInstanceOf(downloads.DownloadCancelled);
    unsubscribe();
    expect(native.createDownloadTask).toHaveBeenCalledTimes(1);
    expect(rows.find((d) => d.id === "n2")).toBeUndefined(); // not left as "Failed — Retry"
    expect(mockDisk.deleted).toContain(`${ROOT}/n2`);
  });
});

describe("retry", () => {
  const entry = (id) => ({ id, book: { id, title: "R" }, files: [{ title: "a", filename: "a.mp3", url: "https://cdn/expired-a" }, { title: "b", filename: "b.mp3", url: "https://cdn/expired-b" }] });

  test("asks the server for fresh links first, matched by filename", async () => {
    api.getStreams.mockResolvedValueOnce({ ready: true, streams: [
      { filename: "b.mp3", url: "https://cdn/fresh-b" }, { filename: "a.mp3", url: "https://cdn/fresh-a" },
    ] });
    await downloads.retryDownload(entry("r1"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.createDownloadTask.mock.calls.map(([o]) => o.url)).toEqual(["https://cdn/fresh-a", "https://cdn/fresh-b"]);
  });

  test("falls back to the stored links when the server is unreachable", async () => {
    api.getStreams.mockRejectedValueOnce(new Error("offline"));
    await downloads.retryDownload(entry("r2"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.createDownloadTask.mock.calls.map(([o]) => o.url)).toEqual(["https://cdn/expired-a", "https://cdn/expired-b"]);
  });
});

describe("download integrity", () => {
  const one = [{ url: "https://cdn/part", filename: "part.mp3", size: 100 }];
  async function recover(id, files, extra = {}) {
    await AsyncStorage.setItem("bustaudio_dljobs", JSON.stringify({ [id]: { book: { id, title: id }, files, ...extra } }));
    await downloads.resumePendingDownloads();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  test.each([40, 120])("redownloads a recovered %i-byte file instead of publishing an incomplete book", async (size) => {
    mockDisk.files.set(`${ROOT}/partial/part.mp3`, size);
    await recover("partial", one);
    expect(native.createDownloadTask).toHaveBeenCalledTimes(1);
    expect(mockDisk.files.get(`${ROOT}/partial/part.mp3`)).toBe(100);
    expect((await library.getBook("partial")).downloaded).toBe(true);
  });

  test("unknown-size files without completion evidence are downloaded again", async () => {
    mockDisk.files.set(`${ROOT}/unknown/part.mp3`, 40);
    await recover("unknown", [{ url: "https://cdn/part", filename: "part.mp3" }]);
    expect(native.createDownloadTask).toHaveBeenCalledTimes(1);
  });

  test("reuses a validated finished part even when the server did not report its size", async () => {
    mockDisk.files.set(`${ROOT}/verified/0001-part.mp3`, 100);
    await recover("verified", [{ url: "https://cdn/part", filename: "part.mp3" }], { namingVersion: 2, completedParts: { 0: { size: 100 } } });
    expect(native.createDownloadTask).not.toHaveBeenCalled();
    expect((await library.getBook("verified")).files[0]).toMatchObject({ uri: `${ROOT}/verified/0001-part.mp3`, size: 100 });
  });

  test("a changed file invalidates its persisted completion evidence", async () => {
    mockDisk.files.set(`${ROOT}/changed/0001-part.mp3`, 40);
    await recover("changed", one, { namingVersion: 2, completedParts: { 0: { size: 100 } } });
    expect(native.createDownloadTask).toHaveBeenCalledTimes(1);
  });

  test("recovered native DONE still needs its expected complete file", async () => {
    mockDisk.files.set(`${ROOT}/bad-done/part.mp3`, 40);
    mockTasks.push({ id: "bad-done-0", state: "DONE" });
    await recover("bad-done", one);
    expect(await library.getBook("bad-done")).toBeNull();
  });

  test("new parts with colliding sanitized or truncated filenames keep distinct local files", async () => {
    const names = ["a b.mp3", "a_b.mp3", `${"a".repeat(90)}1.mp3`, `${"a".repeat(90)}2.mp3`];
    const entry = await downloads.downloadBook({ id: "collisions", title: "C" }, names.map((filename, i) => ({ filename, url: `https://cdn/${i}` })));
    expect(new Set(entry.files.map((f) => f.uri)).size).toBe(4);
    expect(entry.files.map((f) => f.filename)).toEqual(names);
  });

  test("legacy unfinished jobs restart into their original destination", async () => {
    await recover("legacy", one);
    expect(native.createDownloadTask).toHaveBeenCalledWith(expect.objectContaining({ destination: "/data/docs/bustaudio/legacy/part.mp3" }));
  });

  test("a successful native callback cannot publish a file of the wrong known size", async () => {
    mockNative.completedSize = 40;
    await expect(downloads.downloadBook({ id: "truncated", title: "T" }, one)).rejects.toThrow(/incomplete|size/i);
    expect(await library.getBook("truncated")).toBeNull();
  });

  test("simultaneous starts reserve the book before either persistence finishes", async () => {
    const book = { id: "simultaneous", title: "S" };
    const results = await Promise.allSettled([downloads.downloadBook(book, one), downloads.downloadBook(book, one)]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(native.createDownloadTask).toHaveBeenCalledTimes(1);
  });

  test("failed job storage prevents native work and rejects durable acceptance", async () => {
    AsyncStorage.setItem.mockRejectedValueOnce(new Error("storage full"));
    await expect(downloads.enqueueDownload({ id: "storage-fail", title: "S" }, one)).rejects.toThrow("storage full");
    expect(native.createDownloadTask).not.toHaveBeenCalled();
    expect(await library.getBook("storage-fail")).toBeNull();
  });

  test("acceptance waits for persistence but does not wait for transfer completion", async () => {
    const original = AsyncStorage.setItem.getMockImplementation();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    AsyncStorage.setItem.mockImplementationOnce(async (...args) => { await gate; return original(...args); });
    mockNative.hang = true;
    let accepted = false;
    const pending = downloads.enqueueDownload({ id: "acceptance", title: "A" }, one).then(() => { accepted = true; });
    await tick();
    expect(accepted).toBe(false);
    expect(native.createDownloadTask).not.toHaveBeenCalled();
    release();
    await pending;
    expect(JSON.parse(await AsyncStorage.getItem("bustaudio_dljobs")).acceptance.namingVersion).toBe(2);
    expect(await library.getBook("acceptance")).toBeNull();
    await downloads.cancelDownload("acceptance");
    await tick();
  });
});

describe("download setup and recovery boundaries", () => {
  const one = [{ url: "https://cdn/part", filename: "part.mp3", size: 100 }];

  test("a stale pending job never overwrites an already completed offline copy", async () => {
    const saved = await library.upsertBook({ id: "already-local", title: "A", downloaded: true, storageDir: "old-folder", files: [{ uri: `${ROOT}/old-folder/original.mp3`, size: 100 }] });
    mockDisk.files.set(`${ROOT}/old-folder/original.mp3`, 100);
    await AsyncStorage.setItem("bustaudio_dljobs", JSON.stringify({ "already-local": { book: { id: "already-local", title: "A" }, files: one } }));
    await downloads.resumePendingDownloads();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.createDownloadTask).not.toHaveBeenCalled();
    expect(await library.getBook("already-local")).toEqual(saved);
    expect(mockDisk.deleted).toEqual([]);
  });

  test("cancelling while disk inspection is pending never starts a new native transfer", async () => {
    const disk = require("expo-file-system/legacy");
    let release;
    disk.getInfoAsync.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const done = downloads.downloadBook({ id: "cancel-preparing", title: "C" }, one);
    await tick();
    await downloads.cancelDownload("cancel-preparing");
    release({ exists: false });
    await expect(done).rejects.toBeInstanceOf(downloads.DownloadCancelled);
    expect(native.createDownloadTask).not.toHaveBeenCalled();
    expect(mockDisk.deleted).toContain(`${ROOT}/cancel-preparing`);
  });

  test("an unreadable job store cannot overwrite other pending jobs", async () => {
    await AsyncStorage.setItem("bustaudio_dljobs", JSON.stringify({ other: { book: { id: "other" }, files: one } }));
    AsyncStorage.getItem.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(downloads.enqueueDownload({ id: "read-fail", title: "R" }, one)).rejects.toThrow("storage unavailable");
    expect(Object.keys(JSON.parse(await AsyncStorage.getItem("bustaudio_dljobs")))).toEqual(["other"]);
    expect(native.createDownloadTask).not.toHaveBeenCalled();
  });

  test("completion evidence is saved before advancing to the next part", async () => {
    const done = downloads.downloadBook({ id: "checkpoint", title: "C" }, [...one, { ...one[0], filename: "second.mp3" }], (index) => {
      if (index === 0) mockNative.hang = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(JSON.parse(await AsyncStorage.getItem("bustaudio_dljobs")).checkpoint.completedParts).toEqual({ 0: { size: 100 } });
    await downloads.cancelDownload("checkpoint");
    await expect(done).rejects.toBeInstanceOf(downloads.DownloadCancelled);
  });

  test("preparing remains visible until native work reports activity", async () => {
    const store = require("../downloadStore");
    let rows;
    const unsubscribe = store.subscribe((items) => { rows = items; });
    mockNative.hang = true;
    await downloads.enqueueDownload({ id: "visible-preparing", title: "P" }, one);
    expect(rows.find((d) => d.id === "visible-preparing").status).toBe("preparing");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rows.find((d) => d.id === "visible-preparing").status).toBe("downloading");
    await downloads.cancelDownload("visible-preparing");
    await tick();
    unsubscribe();
  });
});

test("failed native discovery leaves pending transfers untouched for later recovery", async () => {
  const job = { book: { id: "discovery", title: "D" }, files: [{ url: "https://cdn/part", filename: "part.mp3" }] };
  await AsyncStorage.setItem("bustaudio_dljobs", JSON.stringify({ discovery: job }));
  mockDisk.files.set(`${ROOT}/discovery/part.mp3`, 40);
  native.getExistingDownloadTasks.mockRejectedValueOnce(new Error("native unavailable"));
  await expect(downloads.resumePendingDownloads()).rejects.toThrow("native unavailable");
  expect(native.createDownloadTask).not.toHaveBeenCalled();
  expect(mockDisk.deleted).toEqual([]);
  expect(JSON.parse(await AsyncStorage.getItem("bustaudio_dljobs"))).toEqual({ discovery: job });
});

test("a cleanup storage read failure cannot prevent cancellation file cleanup", async () => {
  mockNative.hang = true;
  const done = downloads.downloadBook({ id: "cleanup-read", title: "C" }, [{ url: "https://cdn/part", filename: "part.mp3" }]);
  await tick();
  AsyncStorage.getItem.mockRejectedValueOnce(new Error("storage unavailable"));
  await downloads.cancelDownload("cleanup-read");
  await expect(done).rejects.toBeInstanceOf(downloads.DownloadCancelled);
  expect(mockDisk.deleted).toContain(`${ROOT}/cleanup-read`);
});


describe("downloads restored after reinstall", () => {
  const one = [{ url: "https://cdn/part", filename: "part.mp3", size: 100 }];
  test("a restored downloaded flag cannot skip re-downloading missing audio", async () => {
    const progress = { trackIndex: 0, position: 1234, finished: false };
    await library.upsertBook({ id: "restored", title: "Restored", downloaded: true, storageDir: "old", files: [{ uri: ROOT + "/old/missing.mp3", size: 100 }], progress });
    const result = await downloads.downloadBook({ id: "restored", title: "Restored" }, one);
    expect(result.files).toEqual([{ uri: ROOT + "/restored/0001-part.mp3", filename: "part.mp3", size: 100 }]);
    expect(result.progress).toEqual(progress);
    expect(mockDisk.files.get(result.files[0].uri)).toBe(100);
  });
  test("startup repairs missing and truncated downloads even with no pending jobs", async () => {
    for (const id of ["missing", "truncated", "valid"]) {
      await library.upsertBook({ id, title: id, downloaded: true, downloadedAt: 10, storageDir: id,
        files: [{ uri: ROOT + "/" + id + "/part.mp3", size: 100 }], progress: { trackIndex: 2, position: 456, finished: true },
        saved: true, bookmarks: [{ trackIndex: 1, position: 23 }] });
    }
    mockDisk.files.set(ROOT + "/truncated/part.mp3", 50);
    mockDisk.files.set(ROOT + "/valid/part.mp3", 100);
    await downloads.resumePendingDownloads();
    for (const id of ["missing", "truncated"]) {
      const entry = await library.getBook(id);
      expect(entry.downloaded).toBeUndefined();
      expect(entry.files).toEqual([]);
      expect(entry.storageDir).toBeUndefined();
      expect(entry).toMatchObject({ saved: true, progress: { trackIndex: 2, position: 456, finished: true }, bookmarks: [{ trackIndex: 1, position: 23 }] });
    }
    expect((await library.getBook("valid")).downloaded).toBe(true);
    expect(mockDisk.deleted).toEqual([]);
  });
  test("a failed disk check does not erase a downloaded library entry", async () => {
    const entry = await library.upsertBook({ id: "disk-error", downloaded: true, files: [{ uri: ROOT + "/part.mp3", size: 100 }] });
    require("expo-file-system/legacy").getInfoAsync.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(downloads.resumePendingDownloads()).rejects.toThrow("disk unavailable");
    expect(await library.getBook("disk-error")).toEqual(entry);
    require("expo-file-system/legacy").getInfoAsync.mockClear();
  });
  test("a stale missing-file check does not clear a newly replaced download", async () => {
    await library.upsertBook({ id: "replaced", downloaded: true, files: [{ uri: ROOT + "/old.mp3", size: 100 }] });
    let release;
    require("expo-file-system/legacy").getInfoAsync.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const recovery = downloads.resumePendingDownloads();
    await tick();
    if (!release) { await recovery; throw new Error("Restored download was not inspected"); }
    const newer = await library.upsertBook({ id: "replaced", downloaded: true, downloadedAt: 20, files: [{ uri: ROOT + "/new.mp3", size: 200 }] });
    release({ exists: false });
    await recovery;
    expect(await library.getBook("replaced")).toEqual(newer);
  });
});
