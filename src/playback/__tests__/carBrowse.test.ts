import { buildBrowseTree } from "../carBrowse";

const local = (n: number) => Array.from({ length: n }, (_, i) => ({ uri: `file:///p${i}.mp3`, title: `Part ${i + 1}.mp3` }));

test("Android Auto lists downloaded books: in progress first, each a folder of its parts", () => {
  const tree = buildBrowseTree([
    { id: "a", title: "Reading", author: "Writer", poster: "https://x/a.jpg", downloaded: true, files: local(3), progress: { trackIndex: 1, position: 600, lastPlayed: 5 } },
    { id: "b", title: "Not started", downloaded: true, downloadedAt: 2, files: local(1) },
    { id: "c", title: "Streaming only", files: [{ url: "https://cdn/c" }], progress: { position: 900 } },
    { id: "d", title: "Done", downloaded: true, files: local(1), progress: { finished: true, position: 1 } },
  ]);
  expect(tree.map((c) => [c.title, c.items.map((i) => i.title)])).toEqual([
    ["Continue listening", ["Reading"]],
    ["Downloaded", ["Not started"]],
  ]);
  const reading = tree[0]!.items[0]!;
  expect(reading.children.map((p) => [p.mediaId, p.title, p.url])).toEqual([
    ["a:0", "Part 1", "file:///p0.mp3"],
    ["a:1", "▶ Resume · Part 2", "file:///p1.mp3"],
    ["a:2", "Part 3", "file:///p2.mp3"],
  ]);
  expect(reading.children[1]).toMatchObject({ artist: "Writer", artworkUrl: "https://x/a.jpg", extras: { bookId: "a", trackIndex: 1 } });
});

test("with nothing downloaded the car shows an empty Downloaded folder", () => {
  expect(buildBrowseTree([])).toEqual([{ mediaId: "cat:downloaded", title: "Downloaded", items: [] }]);
});
