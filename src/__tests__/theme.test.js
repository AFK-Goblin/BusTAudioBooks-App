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

function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

test("every accent offers a readable white-text button surface", () => {
  for (const accent of Object.values(ACCENTS)) {
    expect(accent.button).toMatch(/^#[0-9a-f]{6}$/i);
    expect(1.05 / (luminance(accent.button) + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
  expect(theme.button).toBe(ACCENTS.teal.button);
});
