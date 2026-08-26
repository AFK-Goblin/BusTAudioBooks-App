import { STORAGE_SCHEMA_VERSION, type LibraryItem, type ParseResult } from "../domain/models";
import { readJson, writeJson } from "../storage/gateway";
import { STORAGE_KEYS } from "../storage/keys";

type LibraryStore = Record<string, LibraryItem>;

function parseLibrary(value: unknown): ParseResult<LibraryStore> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, issues: ["library must be an object"] };
  }
  const issues: string[] = [];
  const valid: LibraryStore = {};
  for (const [id, candidate] of Object.entries(value)) {
    if (candidate == null || typeof candidate !== "object" || Array.isArray(candidate)) {
      issues.push(`${id} must be an object`);
      continue;
    }
    const item = candidate as Partial<LibraryItem>;
    if (item.schemaVersion !== STORAGE_SCHEMA_VERSION || item.id !== id || !item.title) {
      issues.push(`${id} is invalid`);
      continue;
    }
    valid[id] = item as LibraryItem;
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: valid };
}

export class LibraryRepository {
  private async store(): Promise<LibraryStore> {
    const result = await readJson(STORAGE_KEYS.libraryV2, parseLibrary);
    if (result.ok) return result.value;
    if (result.kind === "missing") return {};
    throw new Error(`Library unavailable: ${result.kind}`);
  }

  async get(id: string): Promise<LibraryItem | null> {
    return (await this.store())[id] ?? null;
  }

  async list(): Promise<LibraryItem[]> {
    return Object.values(await this.store()).map((item) => structuredClone(item));
  }

  async upsert(item: LibraryItem): Promise<LibraryItem> {
    const store = await this.store();
    store[item.id] = structuredClone(item);
    const result = await writeJson(STORAGE_KEYS.libraryV2, store, parseLibrary);
    if (!result.ok) throw new Error(`Library write failed: ${result.kind}`);
    return structuredClone(result.value[item.id]!);
  }

  async removeLocalResources(id: string): Promise<void> {
    const store = await this.store();
    const item = store[id];
    if (!item) return;
    store[id] = { ...item, localResources: [], updatedAt: Date.now() };
    const result = await writeJson(STORAGE_KEYS.libraryV2, store, parseLibrary);
    if (!result.ok) throw new Error(`Library write failed: ${result.kind}`);
  }

  async removeHistory(id: string): Promise<void> {
    const store = await this.store();
    delete store[id];
    const result = await writeJson(STORAGE_KEYS.libraryV2, store, parseLibrary);
    if (!result.ok) throw new Error(`Library write failed: ${result.kind}`);
  }
}
