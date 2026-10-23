/* global test */
jest.mock("expo-secure-store", () => {
  const store = { bustaudio_accent: "teal" };
  return { getItem: jest.fn((key) => store[key] ?? null), setItem: jest.fn((key, value) => { store[key] = value; }) };
});
const { theme, appliedAccent, storedAccent, saveAccent, ACCENTS } = require("../theme");

test("the saved accent colours the whole theme from launch; a new pick waits for a restart", () => {
  expect(appliedAccent).toBe("teal");
  expect(theme.accent).toBe(ACCENTS.teal.accent);
  expect(theme.gradient).toEqual([ACCENTS.teal.accent, ACCENTS.teal.accent2]);
  saveAccent("pink");
  expect(storedAccent()).toBe("pink");
  expect(theme.accent).toBe(ACCENTS.teal.accent);
  saveAccent("not-a-colour");
  expect(storedAccent()).toBe("violet");
});
