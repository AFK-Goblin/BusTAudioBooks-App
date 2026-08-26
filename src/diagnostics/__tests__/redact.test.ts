import { redactDiagnosticValue } from "../redact";

describe("diagnostic redaction", () => {
  it("removes install configuration segments and signed query strings", () => {
    expect(redactDiagnosticValue({
      install: "https://audio.example/SECRET_CONFIG/manifest.json",
      download: "https://cdn.example/book.mp3?token=secret&expires=123",
      path: "file:///data/user/0/com.bustaudio.app/files/book.mp3",
    })).toEqual({
      install: "https://audio.example/[REDACTED]/manifest.json",
      download: "https://cdn.example/book.mp3?[REDACTED]",
      path: "file:///[PRIVATE_PATH]/book.mp3",
    });
  });
});
