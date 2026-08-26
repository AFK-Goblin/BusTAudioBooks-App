import { STORAGE_SCHEMA_VERSION, type PlaybackSessionRecord } from "../../domain/models";
import { parsePlaybackSession } from "../sessionRepository";

const validSession: PlaybackSessionRecord = {
  schemaVersion: STORAGE_SCHEMA_VERSION,
  itemId: "torbox:book:one",
  queueRevision: "revision-1",
  activeTrackIndex: 0,
  positionSeconds: 54_321,
  rate: 1.25,
  intendedState: "paused",
  checkpointedAt: 1_777_777_777_777,
};

test("accepts a complete playback session", () => {
  expect(parsePlaybackSession(validSession)).toEqual({ ok: true, value: validSession });
});

test.each([
  ["missing item ID", { ...validSession, itemId: "" }],
  ["negative track", { ...validSession, activeTrackIndex: -1 }],
  ["fractional track", { ...validSession, activeTrackIndex: 0.5 }],
  ["negative position", { ...validSession, positionSeconds: -1 }],
  ["non-finite position", { ...validSession, positionSeconds: Number.NaN }],
  ["invalid rate", { ...validSession, rate: 0 }],
  ["invalid intent", { ...validSession, intendedState: "buffering" }],
  ["invalid checkpoint", { ...validSession, checkpointedAt: -1 }],
  ["invalid sleep", { ...validSession, sleep: { mode: "timer", endsAt: -1 } }],
  ["invalid recovery", { ...validSession, recovery: { attemptedAt: 5, reason: "" } }],
])("rejects %s", (_name, candidate) => {
  expect(parsePlaybackSession(candidate).ok).toBe(false);
});

test.each(["url", "token", "authorization"])("rejects embedded %s data", (key) => {
  expect(parsePlaybackSession({ ...validSession, [key]: "secret" }).ok).toBe(false);
  expect(parsePlaybackSession({ ...validSession, recovery: { attemptedAt: 5, reason: "network", [key]: "secret" } }).ok).toBe(false);
});

test("accepts both supported sleep modes and valid recovery metadata", () => {
  expect(parsePlaybackSession({ ...validSession, sleep: { mode: "timer", endsAt: 99 } }).ok).toBe(true);
  expect(parsePlaybackSession({ ...validSession, sleep: { mode: "end-of-track" } }).ok).toBe(true);
  expect(parsePlaybackSession({ ...validSession, recovery: { attemptedAt: 99, reason: "expired-stream" } }).ok).toBe(true);
});
