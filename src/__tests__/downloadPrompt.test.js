/* global test, beforeEach */
import { Alert } from "react-native";

const mockFree = { bytes: 0 };
jest.mock("expo-file-system/legacy", () => ({ getFreeDiskStorageAsync: jest.fn(async () => mockFree.bytes) }));
jest.mock("../downloads", () => ({ startDownload: jest.fn() }));

const { downloadWithSpaceCheck, checkSpace } = require("../downloadPrompt");
const { startDownload } = require("../downloads");
const GB = 1024 ** 3;
const book = { id: "b", title: "Big Book" };
const files = [{ url: "https://x/1", size: GB }, { url: "https://x/2", size: GB / 2 }];

beforeEach(() => { startDownload.mockClear(); });

test("starts straight away when it fits with room to spare", async () => {
  mockFree.bytes = 4 * GB;
  expect(await downloadWithSpaceCheck(book, files)).toBe(true);
  expect(startDownload).toHaveBeenCalledWith(book, files);
});

test("asks first when it won't fit, and respects the answer", async () => {
  mockFree.bytes = GB;
  const alert = jest.spyOn(Alert, "alert").mockImplementation((title, body, buttons) => buttons[0].onPress());
  expect(await downloadWithSpaceCheck(book, files)).toBe(false);
  expect(alert.mock.calls[0][1]).toBe("This book needs 1.5 GB, but your phone only has 1.0 GB free.");
  expect(startDownload).not.toHaveBeenCalled();
  alert.mockImplementation((title, body, buttons) => buttons[1].onPress());
  expect(await downloadWithSpaceCheck(book, files)).toBe(true);
  expect(startDownload).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});

test("without sizes from the server there is nothing to check", async () => {
  mockFree.bytes = 0;
  expect((await checkSpace([{ url: "https://x/1" }])).enough).toBe(true);
});
