import type { DownloadJobRecord, ParseResult } from "../domain/models";
import { readJson, writeJson } from "../storage/gateway";
import { STORAGE_KEYS } from "../storage/keys";

type DownloadStore = Record<string, DownloadJobRecord>;

function parseDownloads(value: unknown): ParseResult<DownloadStore> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? { ok: true, value: value as DownloadStore }
    : { ok: false, issues: ["download store is invalid"] };
}

export class DownloadRepository {
  async list(): Promise<DownloadJobRecord[]> {
    const result = await readJson(STORAGE_KEYS.downloadJobsV2, parseDownloads);
    if (result.ok) return Object.values(result.value);
    if (result.kind === "missing") return [];
    throw new Error(`Downloads unavailable: ${result.kind}`);
  }

  async upsert(job: DownloadJobRecord): Promise<void> {
    const current = Object.fromEntries((await this.list()).map((item) => [item.id, item]));
    current[job.id] = job;
    const result = await writeJson(STORAGE_KEYS.downloadJobsV2, current, parseDownloads);
    if (!result.ok) throw new Error(`Download write failed: ${result.kind}`);
  }
}
