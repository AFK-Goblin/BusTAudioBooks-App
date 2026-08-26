import { STORAGE_SCHEMA_VERSION, type SettingsRecord } from "../domain/models";
import { parseSettingsRecord } from "../domain/validation";
import { readJson, writeJson } from "../storage/gateway";
import { STORAGE_KEYS } from "../storage/keys";

export const DEFAULT_SETTINGS: SettingsRecord = {
  schemaVersion: STORAGE_SCHEMA_VERSION,
  speed: 1,
  jumpBack: 15,
  jumpForward: 30,
  wifiOnly: false,
  autoResume: false,
  autoDeleteFinished: false,
  dataSaver: false,
  comicsEnabled: false,
};

export class SettingsRepository {
  private current: SettingsRecord = DEFAULT_SETTINGS;
  private readonly listeners = new Set<(settings: SettingsRecord) => void>();

  async initialize(): Promise<SettingsRecord> {
    const stored = await readJson(STORAGE_KEYS.settingsV2, parseSettingsRecord);
    this.current = stored.ok ? stored.value : DEFAULT_SETTINGS;
    if (!stored.ok && stored.kind === "missing") {
      const written = await writeJson(STORAGE_KEYS.settingsV2, this.current, parseSettingsRecord);
      if (!written.ok) throw new Error(`Settings write failed: ${written.kind}`);
    }
    this.emit();
    return { ...this.current };
  }

  get(): SettingsRecord {
    return { ...this.current };
  }

  async set<K extends keyof Omit<SettingsRecord, "schemaVersion">>(key: K, value: SettingsRecord[K]): Promise<SettingsRecord> {
    const next = { ...this.current, [key]: value };
    const written = await writeJson(STORAGE_KEYS.settingsV2, next, parseSettingsRecord);
    if (!written.ok) throw new Error(`Settings write failed: ${written.kind}`);
    this.current = written.value;
    this.emit();
    return { ...this.current };
  }

  subscribe(listener: (settings: SettingsRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = { ...this.current };
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
