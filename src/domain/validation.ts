import type { AudiobookProgress, DownloadJobRecord, ParseResult, SettingsRecord } from "./models";
import { STORAGE_SCHEMA_VERSION } from "./models";

const DOWNLOAD_STATES = new Set([
  "queued", "resolving", "waiting-network", "downloading", "paused",
  "verifying", "complete", "failed", "cancelled",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return nonNegative(value) && Number.isInteger(value);
}

export function parseSettingsRecord(value: unknown): ParseResult<SettingsRecord> {
  const input = record(value);
  if (!input) return { ok: false, issues: ["settings must be an object"] };
  if (input.schemaVersion !== STORAGE_SCHEMA_VERSION) {
    return { ok: false, issues: ["schemaVersion must be 2"] };
  }
  if (typeof input.comicsEnabled !== "boolean") {
    return { ok: false, issues: ["comicsEnabled must be a boolean"] };
  }
  return {
    ok: true,
    value: {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      speed: nonNegative(input.speed) && input.speed > 0 ? input.speed : 1,
      jumpBack: nonNegativeInteger(input.jumpBack) && input.jumpBack > 0 ? input.jumpBack : 15,
      jumpForward: nonNegativeInteger(input.jumpForward) && input.jumpForward > 0 ? input.jumpForward : 30,
      wifiOnly: typeof input.wifiOnly === "boolean" ? input.wifiOnly : false,
      autoResume: typeof input.autoResume === "boolean" ? input.autoResume : false,
      autoDeleteFinished: typeof input.autoDeleteFinished === "boolean" ? input.autoDeleteFinished : false,
      dataSaver: typeof input.dataSaver === "boolean" ? input.dataSaver : false,
      comicsEnabled: input.comicsEnabled,
    },
  };
}

export function parseAudiobookProgress(value: unknown): ParseResult<AudiobookProgress> {
  const input = record(value);
  if (!input) return { ok: false, issues: ["progress must be an object"] };
  const issues: string[] = [];
  if (!nonNegativeInteger(input.trackIndex)) issues.push("trackIndex must be a non-negative integer");
  if (!nonNegative(input.positionSeconds)) issues.push("positionSeconds must be a finite non-negative number");
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    value: {
      trackIndex: input.trackIndex as number,
      positionSeconds: input.positionSeconds as number,
      finished: input.finished === true,
      lastPlayedAt: nonNegative(input.lastPlayedAt) ? input.lastPlayedAt : 0,
    },
  };
}

export function parseDownloadJobRecord(value: unknown): ParseResult<DownloadJobRecord> {
  const input = record(value);
  if (!input) return { ok: false, issues: ["download job must be an object"] };
  if (typeof input.state !== "string" || !DOWNLOAD_STATES.has(input.state)) {
    return { ok: false, issues: ["state is invalid"] };
  }
  const issues: string[] = [];
  if (input.schemaVersion !== STORAGE_SCHEMA_VERSION) issues.push("schemaVersion must be 2");
  if (typeof input.id !== "string" || !input.id) issues.push("id is required");
  if (typeof input.itemId !== "string" || !input.itemId) issues.push("itemId is required");
  if (input.kind !== "audiobook" && input.kind !== "comic") issues.push("kind is invalid");
  if (!Array.isArray(input.sources)) issues.push("sources must be an array");
  if (!Array.isArray(input.destinations)) issues.push("destinations must be an array");
  if (!nonNegative(input.bytesDownloaded)) issues.push("bytesDownloaded must be non-negative");
  if (!nonNegative(input.bytesTotal)) issues.push("bytesTotal must be non-negative");
  if (typeof input.wifiOnly !== "boolean") issues.push("wifiOnly must be a boolean");
  if (!nonNegativeInteger(input.retryCount)) issues.push("retryCount must be a non-negative integer");
  if (!nonNegative(input.createdAt)) issues.push("createdAt must be non-negative");
  if (!nonNegative(input.updatedAt)) issues.push("updatedAt must be non-negative");
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: input as unknown as DownloadJobRecord };
}
