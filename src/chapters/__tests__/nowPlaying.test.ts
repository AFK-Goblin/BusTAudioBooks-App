import { followChapterTitles } from "../nowPlaying";
import type { PlaybackSnapshot } from "../../playback/types";

const book = { id: "b", title: "The Adventures", author: "Doyle", files: [{ filename: "a.m4b", url: "https://cdn/a" }] };
const chapters = [{ start: 0, title: "A Scandal in Bohemia" }, { start: 3983, title: "The Red-Headed League" }];
const snap = (patch: Partial<PlaybackSnapshot>): PlaybackSnapshot => ({
  status: "playing", intent: "playing", book, activeTrackIndex: 0, positionSeconds: 10, durationSeconds: 9000, rate: 1, sleep: { mode: "off" }, ...patch,
});

function harness() {
  let listener: (s: PlaybackSnapshot) => void = () => {};
  const updateMetadata = jest.fn(async () => {});
  const chaptersFor = jest.fn(async () => chapters);
  followChapterTitles({ subscribe: (l) => { listener = l; return () => {}; }, chaptersFor, updateMetadata });
  const emit = async (s: PlaybackSnapshot) => { listener(s); await new Promise((r) => setTimeout(r, 0)); };
  return { emit, updateMetadata, chaptersFor };
}

test("retitles the playing item once per chapter", async () => {
  const h = harness();
  await h.emit(snap({}));
  expect(h.updateMetadata).toHaveBeenLastCalledWith(0, { title: "A Scandal in Bohemia", albumTitle: "The Adventures", artist: "Doyle" });
  await h.emit(snap({ positionSeconds: 500 }));
  expect(h.updateMetadata).toHaveBeenCalledTimes(1);
  await h.emit(snap({ positionSeconds: 4000 }));
  expect(h.updateMetadata).toHaveBeenLastCalledWith(0, expect.objectContaining({ title: "The Red-Headed League" }));
  expect(h.chaptersFor).toHaveBeenCalledTimes(1);
});

test("re-applies the title after the queue is rebuilt", async () => {
  const h = harness();
  await h.emit(snap({}));
  await h.emit(snap({ status: "reconnecting" }));
  await h.emit(snap({ book: { ...book } })); // stream refresh: same book, new object
  expect(h.updateMetadata).toHaveBeenCalledTimes(2);
});

test("books without chapters are left alone", async () => {
  const h = harness();
  h.chaptersFor.mockResolvedValue(null as any);
  await h.emit(snap({}));
  await h.emit(snap({ positionSeconds: 5000 }));
  expect(h.updateMetadata).not.toHaveBeenCalled();
});
