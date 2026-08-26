import {
  parseAudiobookProgress,
  parseDownloadJobRecord,
  parseSettingsRecord,
} from "../validation";

describe("domain record validation", () => {
  it("accepts a valid settings record and keeps comics disabled", () => {
    const result = parseSettingsRecord({ schemaVersion: 2, comicsEnabled: false });

    expect(result).toEqual({
      ok: true,
      value: {
        schemaVersion: 2,
        speed: 1,
        jumpBack: 15,
        jumpForward: 30,
        wifiOnly: false,
        autoResume: false,
        autoDeleteFinished: false,
        dataSaver: false,
        comicsEnabled: false,
      },
    });
  });

  it("rejects invalid audiobook positions instead of normalizing corrupt data", () => {
    const result = parseAudiobookProgress({
      trackIndex: -1,
      positionSeconds: Number.NaN,
      finished: false,
      lastPlayedAt: 1,
    });

    expect(result).toEqual({
      ok: false,
      issues: ["trackIndex must be a non-negative integer", "positionSeconds must be a finite non-negative number"],
    });
  });

  it("rejects download jobs with an unknown state", () => {
    const result = parseDownloadJobRecord({
      schemaVersion: 2,
      id: "download:book-1",
      itemId: "book-1",
      kind: "audiobook",
      state: "mystery",
      sources: [],
      destinations: [],
      bytesDownloaded: 0,
      bytesTotal: 0,
      wifiOnly: false,
      retryCount: 0,
      createdAt: 1,
      updatedAt: 1,
    });

    expect(result).toEqual({ ok: false, issues: ["state is invalid"] });
  });
});
