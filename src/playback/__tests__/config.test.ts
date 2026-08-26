import { buildMediaItems, buildPlayerConfig, buildRemoteCommands, parseMediaId } from "../config";

describe("audiobook player configuration", () => {
  test("uses speech audio and native remote controls", () => {
    expect(buildPlayerConfig()).toMatchObject({
      contentType: "speech",
      handleAudioBecomingNoisy: true,
      android: { wakeMode: "network", taskRemovedBehavior: "continue" },
      progressSync: { intervalSeconds: 5 },
    });
    expect(buildRemoteCommands(30, 15)).toMatchObject({
      handling: "native",
      forwardInterval: 30,
      backwardInterval: 15,
    });
    expect(buildRemoteCommands(30, 15).capabilities).toEqual([
      "skipBackward", "playPause", "skipForward", "seek",
    ]);
  });

  test("creates stable media IDs and audiobook metadata", () => {
    const items = buildMediaItems({
      id: "book-1",
      title: "A Book",
      author: "An Author",
      poster: "https://images.test/cover.jpg",
      files: [{ title: "Chapter One", url: "https://audio.test/1.mp3" }],
    });
    expect(items).toEqual([expect.objectContaining({
      mediaId: "book-1:0",
      title: "Chapter One",
      albumTitle: "A Book",
      artworkUrl: "https://images.test/cover.jpg",
      extras: { bookId: "book-1", trackIndex: 0 },
    })]);
  });

  test("recovers book and chapter identity in the Android background handler", () => {
    expect(parseMediaId("torbox:book:with:colons:12")).toEqual({
      bookId: "torbox:book:with:colons",
      trackIndex: 12,
    });
    expect(parseMediaId("invalid")).toBeNull();
  });
});
