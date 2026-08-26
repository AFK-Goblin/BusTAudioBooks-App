import type { ParseResult, PlaybackSessionRecord } from "../domain/models";
import { readJson, removeStoredValue, writeJson } from "../storage/gateway";
import { STORAGE_KEYS } from "../storage/keys";

const forbiddenKeys = new Set(["url", "token", "authorization"]);

function hasForbiddenKey(value: unknown): boolean {
  if (value == null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => forbiddenKeys.has(key.toLowerCase()) || hasForbiddenKey(child));
}

function finiteAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

export function parsePlaybackSession(value: unknown): ParseResult<PlaybackSessionRecord> {
  if (value == null || typeof value !== "object" || Array.isArray(value) || hasForbiddenKey(value)) {
    return { ok: false, issues: ["playback session is invalid"] };
  }
  const session = value as Partial<PlaybackSessionRecord>;
  const sleepValid = session.sleep === undefined ||
    (session.sleep.mode === "timer" && finiteAtLeast(session.sleep.endsAt, 0)) ||
    session.sleep.mode === "end-of-track";
  const recoveryValid = session.recovery === undefined ||
    (finiteAtLeast(session.recovery.attemptedAt, 0) && typeof session.recovery.reason === "string" && session.recovery.reason.length > 0);
  const valid = session.schemaVersion === 2 &&
    typeof session.itemId === "string" && session.itemId.length > 0 &&
    typeof session.queueRevision === "string" && session.queueRevision.length > 0 &&
    Number.isInteger(session.activeTrackIndex) && finiteAtLeast(session.activeTrackIndex, 0) &&
    finiteAtLeast(session.positionSeconds, 0) && finiteAtLeast(session.rate, Number.MIN_VALUE) &&
    (session.intendedState === "playing" || session.intendedState === "paused" || session.intendedState === "stopped") &&
    finiteAtLeast(session.checkpointedAt, 0) && sleepValid && recoveryValid;
  return valid
    ? { ok: true, value: session as PlaybackSessionRecord }
    : { ok: false, issues: ["playback session is invalid"] };
}

export class SessionRepository {
  async get(): Promise<PlaybackSessionRecord | null> {
    const result = await readJson(STORAGE_KEYS.playbackSessionV2, parsePlaybackSession);
    if (result.ok) return result.value;
    if (result.kind === "missing") return null;
    throw new Error(`Session unavailable: ${result.kind}`);
  }

  async checkpoint(session: PlaybackSessionRecord): Promise<void> {
    const result = await writeJson(STORAGE_KEYS.playbackSessionV2, session, parsePlaybackSession);
    if (!result.ok) throw new Error(`Session write failed: ${result.kind}`);
  }

  async clear(): Promise<void> {
    const result = await removeStoredValue(STORAGE_KEYS.playbackSessionV2);
    if (!result.ok) throw result.kind === "storage" ? result.error : new Error(`Session clear failed: ${result.kind}`);
  }
}
