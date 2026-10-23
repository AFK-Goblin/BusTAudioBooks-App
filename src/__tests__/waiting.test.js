/* global test, beforeEach */
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("../api", () => ({ getStreams: jest.fn() }));
jest.mock("../downloads", () => ({ startDownload: jest.fn() }));
jest.mock("../toast", () => ({ showToast: jest.fn() }));
jest.mock("../downloadPrompt", () => ({ checkSpace: jest.fn(async () => ({ enough: true })) }));
const api = require("../api");
const downloads = require("../downloads");
const prompt = require("../downloadPrompt");
const { waitFor, checkWaiting, stopWaiting } = require("../waiting");
const { getBook, upsertBook } = require("../library");

const item = { id: "w1", title: "Slow Book", author: "Author", poster: "p", format: "M4B" };

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  await stopWaiting("w1");
});

test("a waiting book downloads by itself once TorBox has it", async () => {
  await waitFor(item, "Downloading on TorBox (5%). Try again shortly.");
  expect(await getBook("w1")).toMatchObject({ title: "Slow Book" });
  api.getStreams.mockResolvedValueOnce({ ready: false, status: "Downloading on TorBox (60%). Try again shortly.", streams: [] });
  await checkWaiting();
  expect(downloads.startDownload).not.toHaveBeenCalled();
  expect(JSON.parse(await AsyncStorage.getItem("bustaudio_waiting")).w1.status).toMatch(/60%/);

  api.getStreams.mockResolvedValueOnce({ ready: true, streams: [{ title: "a", url: "https://cdn/a", filename: "a.m4b", size: 9 }] });
  await checkWaiting();
  expect(downloads.startDownload).toHaveBeenCalledWith(
    expect.objectContaining({ id: "w1", title: "Slow Book" }),
    [{ title: "a", url: "https://cdn/a", filename: "a.m4b", size: 9 }],
  );
  expect(JSON.parse(await AsyncStorage.getItem("bustaudio_waiting"))).toEqual({});
});

test("it waits for room on the phone, and lets go of books already downloaded", async () => {
  await waitFor(item);
  prompt.checkSpace.mockResolvedValueOnce({ enough: false });
  api.getStreams.mockResolvedValueOnce({ ready: true, streams: [{ title: "a", url: "https://cdn/a", size: 9 }] });
  await checkWaiting();
  expect(downloads.startDownload).not.toHaveBeenCalled();
  expect(JSON.parse(await AsyncStorage.getItem("bustaudio_waiting")).w1.status).toMatch(/short on space/);

  await upsertBook({ id: "w1", downloaded: true, files: [{ uri: "file:///x" }] });
  await checkWaiting();
  expect(api.getStreams).toHaveBeenCalledTimes(1);
  expect(JSON.parse(await AsyncStorage.getItem("bustaudio_waiting"))).toEqual({});
});
