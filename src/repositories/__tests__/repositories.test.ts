import AsyncStorage from "@react-native-async-storage/async-storage";
import { STORAGE_SCHEMA_VERSION, type LibraryItem } from "../../domain/models";
import { STORAGE_KEYS } from "../../storage/keys";
import { LibraryRepository } from "../libraryRepository";
import { SettingsRepository } from "../settingsRepository";

function book(): LibraryItem {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    id: "book-1",
    mediaType: "audiobook",
    title: "Book One",
    authors: ["Author"],
    addedAt: 1,
    updatedAt: 1,
    bookmarks: [],
    localResources: [{
      id: "local:book-1:0",
      mediaIndex: 0,
      uri: "file:///book.mp3",
      verification: "verified",
    }],
    progress: {
      trackIndex: 0,
      positionSeconds: 30,
      finished: false,
      lastPlayedAt: 2,
    },
  };
}

describe("typed repositories", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("removes local resources without deleting history or progress", async () => {
    const repository = new LibraryRepository();
    await repository.upsert(book());

    await repository.removeLocalResources("book-1");

    expect(await repository.get("book-1")).toMatchObject({
      id: "book-1",
      localResources: [],
      progress: { positionSeconds: 30 },
    });
  });

  it("emits settings only after the durable write succeeds", async () => {
    const repository = new SettingsRepository();
    const snapshots: boolean[] = [];
    const unsubscribe = repository.subscribe((settings) => snapshots.push(settings.comicsEnabled));

    await repository.initialize();
    await repository.set("comicsEnabled", true);
    unsubscribe();

    expect(snapshots).toEqual([false, true]);
    expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.settingsV2))!)).toMatchObject({ comicsEnabled: true });
  });
});
