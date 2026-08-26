import AsyncStorage from "@react-native-async-storage/async-storage";
import { STORAGE_SCHEMA_VERSION, type LibraryItem, type SettingsRecord } from "../domain/models";
import { STORAGE_KEYS } from "./keys";

export type MigrationResult =
  | { ok: true; migrated: boolean; itemCount: number }
  | { ok: false; error: Error };

const LEGACY = {
  library: "bustaudio_library",
  settings: "bustaudio_settings",
  downloads: "bustaudio_dljobs",
} as const;

function object(value: unknown): Record<string, any> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function decode(raw: string | null): Record<string, any> {
  if (!raw) return {};
  const value = JSON.parse(raw);
  return object(value);
}

function migrateItem(id: string, value: unknown, now: number): LibraryItem {
  const old = object(value);
  const comic = old.type === "comic";
  const progress = object(old.progress);
  const bookmarks = Array.isArray(old.bookmarks) ? old.bookmarks : [];
  const files = Array.isArray(old.files) ? old.files : [];
  const migrated: LibraryItem = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    id,
    mediaType: comic ? "comic" : "audiobook",
    title: typeof old.title === "string" && old.title ? old.title : "Untitled",
    authors: typeof old.author === "string" && old.author ? [old.author] : [],
    addedAt: typeof old.downloadedAt === "number" ? old.downloadedAt : now,
    updatedAt: now,
    bookmarks: bookmarks.map((bookmark) => {
      const bm = object(bookmark);
      const createdAt = Number.isFinite(bm.createdAt) ? bm.createdAt : now;
      const trackIndex = Number.isInteger(bm.trackIndex) && bm.trackIndex >= 0 ? bm.trackIndex : 0;
      const positionSeconds = Number.isFinite(bm.position) && bm.position >= 0 ? bm.position : 0;
      return {
        id: `bookmark:${id}:${createdAt}:${trackIndex}:${Math.round(positionSeconds)}`,
        trackIndex,
        positionSeconds,
        createdAt,
      };
    }),
    localResources: files.flatMap((file, mediaIndex) => {
      const entry = object(file);
      if (typeof entry.uri !== "string" || !entry.uri.startsWith("file://")) return [];
      return [{
        id: `local:${id}:${mediaIndex}`,
        mediaIndex,
        uri: entry.uri,
        ...(typeof entry.title === "string" ? { filename: entry.title } : {}),
        verification: "unknown" as const,
        ...(Array.isArray(entry.pages) ? { extractedPages: entry.pages.filter((page: unknown) => typeof page === "string") } : {}),
      }];
    }),
    source: old,
  };
  if (Object.keys(progress).length) {
    migrated.progress = comic
      ? {
          ...(typeof progress.chapterId === "string" ? { chapterId: progress.chapterId } : {}),
          ...(typeof progress.chapterNum === "string" ? { chapterNumber: progress.chapterNum } : {}),
          page: Number.isInteger(progress.page) && progress.page >= 0 ? progress.page : 0,
          totalPages: Number.isInteger(progress.totalPages) && progress.totalPages >= 0 ? progress.totalPages : 0,
          finished: progress.finished === true,
          lastReadAt: Number.isFinite(progress.lastRead || progress.lastPlayed) ? (progress.lastRead || progress.lastPlayed) : 0,
        }
      : {
          trackIndex: Number.isInteger(progress.trackIndex) && progress.trackIndex >= 0 ? progress.trackIndex : 0,
          positionSeconds: Number.isFinite(progress.position) && progress.position >= 0 ? progress.position : 0,
          ...(Number.isFinite(progress.duration) && progress.duration >= 0 ? { totalDurationSeconds: progress.duration } : {}),
          finished: progress.finished === true,
          lastPlayedAt: Number.isFinite(progress.lastPlayed) ? progress.lastPlayed : 0,
        };
  }
  return migrated;
}

function migrateSettings(legacy: Record<string, any>, comicsEnabled: boolean): SettingsRecord {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    speed: typeof legacy.speed === "number" && legacy.speed > 0 ? legacy.speed : 1,
    jumpBack: Number.isInteger(legacy.jumpBack) && legacy.jumpBack > 0 ? legacy.jumpBack : 15,
    jumpForward: Number.isInteger(legacy.jumpForward) && legacy.jumpForward > 0 ? legacy.jumpForward : 30,
    wifiOnly: legacy.wifiOnly === true,
    autoResume: legacy.autoResume === true,
    autoDeleteFinished: legacy.autoDeleteFinished === true,
    dataSaver: legacy.dataSaver === true,
    comicsEnabled,
  };
}

export async function runStorageMigration(): Promise<MigrationResult> {
  try {
    const marker = await AsyncStorage.getItem(STORAGE_KEYS.migrationMarker);
    if (marker) {
      const library = decode(await AsyncStorage.getItem(STORAGE_KEYS.libraryV2));
      return { ok: true, migrated: false, itemCount: Object.keys(library).length };
    }
    const legacyValues = await AsyncStorage.multiGet([
      LEGACY.library, LEGACY.settings, LEGACY.downloads,
    ]);
    const rawLibrary = legacyValues[0]?.[1] ?? null;
    const rawSettings = legacyValues[1]?.[1] ?? null;
    const rawDownloads = legacyValues[2]?.[1] ?? null;
    const legacyLibrary = decode(rawLibrary);
    const legacySettings = decode(rawSettings);
    const legacyDownloads = decode(rawDownloads);
    const now = Date.now();
    const library = Object.fromEntries(
      Object.entries(legacyLibrary).map(([id, item]) => [id, migrateItem(id, item, now)]),
    );
    const hasComics = Object.values(library).some((item) => item.mediaType === "comic") ||
      Object.values(legacyDownloads).some((job) => object(object(job).book).type === "comic");
    const settings = migrateSettings(legacySettings, hasComics);
    const backup = { library: rawLibrary, settings: rawSettings, downloads: rawDownloads, createdAt: now };
    await AsyncStorage.multiSet([
      [STORAGE_KEYS.migrationBackup, JSON.stringify(backup)],
      [STORAGE_KEYS.libraryV2, JSON.stringify(library)],
      [STORAGE_KEYS.settingsV2, JSON.stringify(settings)],
      [STORAGE_KEYS.downloadJobsV2, JSON.stringify(legacyDownloads)],
      [STORAGE_KEYS.migrationMarker, JSON.stringify({ from: 1, to: 2, committedAt: now })],
    ]);
    return { ok: true, migrated: true, itemCount: Object.keys(library).length };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
