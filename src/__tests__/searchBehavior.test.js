/* global test, beforeEach */
import React from "react";
import { render as rtlRender, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("../api", () => ({ search: jest.fn(async () => []) }));
jest.mock("../player", () => ({
  usePlaybackSnapshot: () => ({ book: null, intent: "stopped" }),
  resumeOrLoad: jest.fn(async () => {}),
  pause: jest.fn(async () => {}),
}));
jest.mock("../downloadStore", () => ({ useDownloads: () => [] }));
jest.mock("../stats", () => ({ useListeningStats: () => null }));
jest.mock("../series", () => ({
  continueSeries: jest.fn(async () => []),
  seriesNews: jest.fn(async () => []),
  becauseYouListened: jest.fn(async () => null),
  comingLabel: jest.fn(() => "Coming soon"),
}));

const api = require("../api");
const { getSettings, setSetting } = require("../settings");
const SearchScreen = require("../../screens/SearchScreen").default;

const nav = { depth: 1, navigate: jest.fn(), goBack: jest.fn(), reset: jest.fn() };
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const renderSearch = () => rtlRender(
  <SafeAreaProvider initialMetrics={METRICS}>
    <SearchScreen nav={nav} />
  </SafeAreaProvider>
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function startSearch(query) {
  const input = screen.getByPlaceholderText("Search audiobooks…");
  await fireEvent.changeText(input, query);
  await act(() => { void input.props.onSubmitEditing(); });
}
async function pressWithoutWaiting(element) {
  let fiber = element.unstable_fiber;
  while (fiber && typeof fiber.memoizedProps?.onPress !== "function") fiber = fiber.return;
  if (!fiber) throw new Error("Rendered element has no press handler");
  await act(() => { void fiber.memoizedProps.onPress(); });
}


async function renderWithEmptyCache() {
  const view = await renderSearch();
  const clear = screen.queryByLabelText("Clear search");
  if (clear) await fireEvent.press(clear);
  await screen.findByText("Browse");
  return view;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  await act(async () => { await setSetting("instantOnly", false); });
});

test("an older query resolving last cannot replace the latest results", async () => {
  const older = deferred();
  const latest = deferred();
  api.search.mockImplementation((query) => query === "older" ? older.promise : latest.promise);
  await renderWithEmptyCache();

  await startSearch("older");
  await startSearch("latest");
  await act(async () => { latest.resolve([{ id: "latest", title: "Latest Result" }]); await latest.promise; });
  expect(await screen.findByText("Latest Result")).toBeTruthy();

  await act(async () => { older.resolve([{ id: "older", title: "Older Result" }]); await older.promise; });
  expect(screen.queryByText("Older Result")).toBeNull();
  expect(screen.getByText("Latest Result")).toBeTruthy();
});

test("pagination from an old query cannot append after a new query", async () => {
  const oldPage = deferred();
  api.search.mockImplementation((query, page) => {
    if (query === "alpha" && page === 1) return Promise.resolve([{ id: "a1", title: "Alpha One" }]);
    if (query === "alpha" && page === 2) return oldPage.promise;
    return Promise.resolve([{ id: "b1", title: "Beta One" }]);
  });
  await renderWithEmptyCache();

  await startSearch("alpha");
  expect(await screen.findByText("Alpha One")).toBeTruthy();
  await pressWithoutWaiting(screen.getByText("Load more"));
  await waitFor(() => expect(api.search).toHaveBeenCalledWith("alpha", 2));
  await startSearch("beta");
  expect(await screen.findByText("Beta One")).toBeTruthy();

  await act(async () => { oldPage.resolve([{ id: "a2", title: "Alpha Two" }]); await oldPage.promise; });
  expect(screen.queryByText("Alpha One")).toBeNull();
  expect(screen.queryByText("Alpha Two")).toBeNull();
  expect(screen.getByText("Beta One")).toBeTruthy();
});

test("clearing during a request prevents stale results from repopulating the cache", async () => {
  const pending = deferred();
  api.search.mockReturnValue(pending.promise);
  const view = await renderWithEmptyCache();

  await startSearch("vanish");
  await fireEvent.press(screen.getByLabelText("Clear search"));
  expect(await screen.findByText("Browse")).toBeTruthy();
  await act(async () => { pending.resolve([{ id: "stale", title: "Stale Result" }]); await pending.promise; });

  await view.unmount();
  await renderSearch();
  expect(await screen.findByText("Browse")).toBeTruthy();
  expect(screen.queryByText("Stale Result")).toBeNull();
});

test("unmounting during a request prevents stale results from entering the module cache", async () => {
  const pending = deferred();
  api.search.mockReturnValue(pending.promise);
  const view = await renderWithEmptyCache();

  await startSearch("leave");
  await view.unmount();
  await act(async () => { pending.resolve([{ id: "late", title: "Late Result" }]); await pending.promise; });

  await renderSearch();
  expect(await screen.findByText("Browse")).toBeTruthy();
  expect(screen.queryByText("Late Result")).toBeNull();
});

test("Instant only shows zero uncached results and offers to clear filters", async () => {
  api.search.mockResolvedValue([{ id: "slow", title: "Uncached Result", cached: false }]);
  await act(async () => { await setSetting("instantOnly", true); });
  await renderWithEmptyCache();

  await startSearch("uncached");
  expect(await screen.findByText("Nothing here matches these filters.")).toBeTruthy();
  expect(screen.queryByText("Uncached Result")).toBeNull();

  await fireEvent.press(screen.getByText("Clear filters"));
  expect(await screen.findByText("Uncached Result")).toBeTruthy();
  expect(getSettings().instantOnly).toBe(false);
});
