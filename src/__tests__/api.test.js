/* global test, beforeEach */
jest.mock("../config", () => ({ getPrefix: jest.fn(async () => "https://host/cfg") }));
const { search, getStreams } = require("../api");

const respond = (status, body) => jest.fn(async () => ({
  ok: status >= 200 && status < 300, status,
  json: async () => { if (body === undefined) throw new Error("not json"); return body; },
}));

beforeEach(() => { global.fetch = undefined; });

test("server explanations reach the user instead of 'HTTP 503'", async () => {
  global.fetch = respond(503, { results: [], error: "Search is unavailable right now — AudiobookBay: Cloudflare challenge" });
  await expect(search("dune")).rejects.toThrow("Search is unavailable right now — AudiobookBay: Cloudflare challenge");
  global.fetch = respond(502, { ready: false, streams: [], status: "createTorrent failed: invalid magnet" });
  await expect(getStreams("id")).rejects.toThrow("createTorrent failed: invalid magnet");
});

test("bodies without a message keep the status code", async () => {
  global.fetch = respond(500);
  await expect(search("dune")).rejects.toThrow("Server error (HTTP 500)");
  global.fetch = respond(403, { err: "Invalid token" });
  await expect(search("dune")).rejects.toThrow(/access token/);
});

test("no connection and timeouts read as plain advice", async () => {
  global.fetch = jest.fn(async () => { throw new TypeError("Network request failed"); });
  await expect(search("dune")).rejects.toThrow("Can't reach your BusTAudio server. Check your connection — downloaded books still play from the Library.");
  global.fetch = jest.fn(async () => { const e = new Error("Aborted"); e.name = "AbortError"; throw e; });
  await expect(getStreams("id")).rejects.toThrow("Your server took too long to answer.");
});
