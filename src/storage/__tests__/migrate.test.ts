import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { runStorageMigration } from "../migrate";
import { STORAGE_KEYS } from "../keys";

describe("legacy storage migration", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it("creates fresh defaults", async () => {
    expect(await runStorageMigration()).toEqual({ ok: true, migrated: true, itemCount: 0 });

    expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.settingsV2))!)).toMatchObject({
      schemaVersion: 2,
      smartRewind: true,
    });
  });

  it("preserves audiobook progress and leaves comic history behind", async () => {
    await AsyncStorage.setItem("bustaudio_settings", JSON.stringify({ speed: 1.25, wifiOnly: true }));
    await AsyncStorage.setItem("bustaudio_library", JSON.stringify({
      audio1: {
        id: "audio1",
        title: "A Book",
        author: "An Author",
        progress: { trackIndex: 2, position: 42, duration: 100, finished: false, lastPlayed: 99 },
        bookmarks: [{ trackIndex: 2, position: 20, createdAt: 50 }],
        files: [{ title: "Part 3", uri: "file:///documents/book/part3.mp3" }],
        downloaded: true,
      },
      comic1: { id: "comic1", type: "comic", title: "A Comic", files: [] },
    }));

    expect(await runStorageMigration()).toMatchObject({ ok: true, migrated: true, itemCount: 1 });
    const library = JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.libraryV2))!);
    const settings = JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.settingsV2))!);

    expect(library.audio1).toMatchObject({
      mediaType: "audiobook",
      authors: ["An Author"],
      progress: { trackIndex: 2, positionSeconds: 42, lastPlayedAt: 99 },
      bookmarks: [{ id: "bookmark:audio1:50:2:20", positionSeconds: 20 }],
      localResources: [{ uri: "file:///documents/book/part3.mp3" }],
    });
    expect(library.comic1).toBeUndefined();
    expect(settings).toMatchObject({ speed: 1.25, wifiOnly: true });
    expect(settings).not.toHaveProperty("comicsEnabled");
  });

  it("is idempotent and never copies the secure prefix into AsyncStorage", async () => {
    const secret = "https://server.example/SECRET_CONFIG/manifest.json";
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(secret);

    await runStorageMigration();
    expect(await runStorageMigration()).toEqual({ ok: true, migrated: false, itemCount: 0 });

    const values = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
    expect(JSON.stringify(values)).not.toContain("SECRET_CONFIG");
  });
});
