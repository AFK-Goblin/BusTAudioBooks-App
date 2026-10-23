/* global test, beforeEach */
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("../api", () => ({ getSeries: jest.fn(), getSimilar: jest.fn() }));
const api = require("../api");
const { seriesOf, ownedCopy, continueSeries, comingLabel, seriesNews, becauseYouListened } = require("../series");
const { upsertBook } = require("../library");

const book = (position, title, extra = {}) => ({ position: String(position), title, search: title, released: "2021-01-01", upcoming: false, ...extra });
const DCC = (at) => ({
  name: "Dungeon Crawler Carl", position: String(at), total: 3,
  books: [book(1, "Dungeon Crawler Carl"), book(2, "Carl's Doomsday Scenario"), book(3, "The Dungeon Anarchist's Cookbook")],
  next: book(at + 1, ["", "Carl's Doomsday Scenario", "The Dungeon Anarchist's Cookbook"][at]),
});

beforeEach(async () => {
  await AsyncStorage.clear();
  api.getSeries.mockReset();
  api.getSimilar.mockReset();
});

test("series answers are remembered for books in the library only", async () => {
  api.getSeries.mockResolvedValue(DCC(1));
  await upsertBook({ id: "dcc1", title: "Dungeon Crawler Carl - Matt Dinniman", files: [] });
  expect((await seriesOf("dcc1")).name).toBe("Dungeon Crawler Carl");
  expect((await seriesOf("dcc1")).name).toBe("Dungeon Crawler Carl");
  expect(api.getSeries).toHaveBeenCalledTimes(1);
  await seriesOf("not-mine");
  await seriesOf("not-mine");
  expect(api.getSeries).toHaveBeenCalledTimes(3);
  // An old server (404) or no connection: nothing, and nothing remembered.
  api.getSeries.mockRejectedValue(new Error("Server error (HTTP 404)"));
  await upsertBook({ id: "old", title: "Old", files: [] });
  expect(await seriesOf("old")).toBeNull();
  expect(await AsyncStorage.getItem("bustaudio_series:old")).toBeNull();
});

test("a series book counts as yours when nearly all its title is in an entry's", () => {
  const shelf = [{ id: "a", title: "Carl's Doomsday Scenario - Matt Dinniman [M4B]" }, { id: "b", title: "Red Rising - Pierce Brown" }];
  expect(ownedCopy(book(2, "Carl’s Doomsday Scenario"), shelf).id).toBe("a");
  expect(ownedCopy(book(1, "Dungeon Crawler Carl"), shelf)).toBeNull();
});

test("continue the series: the next book after the furthest one you finished, unless you've started it", async () => {
  api.getSeries.mockImplementation(async (id) => (id === "dcc1" ? DCC(1) : id === "dcc2" ? DCC(2) : null));
  const finished = (id, title, lastPlayed) => ({ id, title, files: [], progress: { finished: true, position: 10, lastPlayed } });
  let books = [finished("dcc1", "Dungeon Crawler Carl - Matt Dinniman", 1), finished("solo", "Project Hail Mary", 3)];
  for (const b of books) await upsertBook(b);
  expect((await continueSeries(books)).map((s) => s.book.title)).toEqual(["Carl's Doomsday Scenario"]);
  books = [...books, finished("dcc2", "Carl's Doomsday Scenario - Matt Dinniman", 2)];
  await upsertBook(books[2]);
  expect((await continueSeries(books)).map((s) => s.book.title)).toEqual(["The Dungeon Anarchist's Cookbook"]);
  // Already listening to book 3: nothing to suggest.
  books = [...books, { id: "dcc3", title: "The Dungeon Anarchist's Cookbook", files: [], progress: { position: 600 } }];
  expect(await continueSeries(books)).toEqual([]);
});

test("release dates read naturally", () => {
  const now = new Date(2026, 9, 23);
  expect(comingLabel("2026-11-04", now)).toBe("Coming 4 Nov");
  expect(comingLabel("2027-05-12", now)).toBe("Coming 12 May 2027");
  expect(comingLabel(null, now)).toBe("Coming soon");
});

test("new in your series: just released first, then soonest out; nothing you have or that's old", async () => {
  const now = new Date(2026, 9, 23, 12).getTime();
  api.getSeries.mockResolvedValue({
    name: "Dungeon Crawler Carl", position: "1", total: 4,
    books: [
      book(1, "Dungeon Crawler Carl", { released: "2021-01-28" }),
      book(6, "The Eye of the Bedlam Bride", { released: "2026-10-01" }),
      book(7, "This Inevitable Ruin", { released: "2026-10-15" }),
      book(8, "A Parade of Horribles", { released: "2027-05-12", upcoming: true }),
      book(9, "Book Nine", { released: "2026-12-01" }),
    ],
  });
  const books = [
    { id: "dcc1", title: "Dungeon Crawler Carl - Matt Dinniman", files: [], progress: { finished: true, position: 9, lastPlayed: 1 } },
    { id: "dcc6", title: "The Eye of the Bedlam Bride", files: [] },
  ];
  for (const b of books) await upsertBook(b);
  const news = await seriesNews(books, now);
  expect(news.map((n) => [n.book.title, n.book.upcoming])).toEqual([
    ["This Inevitable Ruin", false], ["Book Nine", true], ["A Parade of Horribles", true],
  ]);
});

test("because you listened: suggestions you don't have, from your most recent book", async () => {
  api.getSimilar.mockImplementation(async (id) => (id === "recent" ? {
    because: "Dungeon Crawler Carl",
    books: [book(1, "Wool"), book(1, "The Primal Hunter"), book(1, "Not Out Yet", { upcoming: true })],
  } : null));
  const books = [
    { id: "older", title: "Older", files: [], progress: { position: 100, lastPlayed: 1 } },
    { id: "recent", title: "Dungeon Crawler Carl - Matt Dinniman", files: [], progress: { finished: true, position: 9, lastPlayed: 5 } },
    { id: "wool", title: "Wool - Hugh Howey", files: [] },
  ];
  const result = await becauseYouListened(books);
  expect(result.because).toBe("Dungeon Crawler Carl");
  expect(result.books.map((b) => b.title)).toEqual(["The Primal Hunter"]);
});
