const fs = require("node:fs");
const path = require("node:path");

// Since Expo SDK 54 the root "expo-file-system" module exports the old
// getInfoAsync/deleteAsync/... names only as stubs that throw at runtime. The
// app wraps those calls in .catch(), so importing them from the root fails
// silently (3.0.0 shipped that way). Every legacy call must use "/legacy".
const LEGACY_NAMES = [
  "getInfoAsync", "readAsStringAsync", "writeAsStringAsync", "deleteAsync", "moveAsync", "copyAsync",
  "makeDirectoryAsync", "readDirectoryAsync", "downloadAsync", "createDownloadResumable",
  "documentDirectory", "cacheDirectory", "EncodingType",
];

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
    return /\.(js|jsx|ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

test("no module uses the throwing root expo-file-system legacy exports", () => {
  const root = process.cwd();
  const files = [...sourceFiles(path.join(root, "src")), ...sourceFiles(path.join(root, "screens")), path.join(root, "App.js")];
  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const namespace = source.match(/import\s+\*\s+as\s+(\w+)\s+from\s+["']expo-file-system["']/);
    if (namespace && LEGACY_NAMES.some((name) => source.includes(`${namespace[1]}.${name}`))) {
      offenders.push(path.relative(root, file));
    }
    const named = source.match(/import\s*\{([^}]*)\}\s*from\s+["']expo-file-system["']/);
    if (named && LEGACY_NAMES.some((name) => new RegExp(`\\b${name}\\b`).test(named[1]))) {
      offenders.push(path.relative(root, file));
    }
  }
  expect(offenders).toEqual([]);
});
/* global test */
