const fs = require("node:fs");
const path = require("node:path");

test("native Android session prefers rewind, play, and fast-forward controls", () => {
  const patches = path.join(process.cwd(), "patches");
  const patch = fs.readdirSync(patches).find((name) => name.startsWith("@rntp+player+"));
  expect(patch).toBeTruthy();
  const source = fs.readFileSync(path.join(patches, patch), "utf8");
  expect(source).toContain("setMediaButtonPreferences");
  expect(source).toContain("COMMAND_SEEK_BACK");
  expect(source).toContain("COMMAND_SEEK_FORWARD");
});
/* global test */
