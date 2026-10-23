import * as SecureStore from "expo-secure-store";

// Accent colours you can pick in Settings → Appearance.
export const ACCENTS = {
  violet: { name: "Violet", accent: "#8b5cf6", accent2: "#6d28d9" },
  blue: { name: "Blue", accent: "#3b82f6", accent2: "#1d4ed8" },
  teal: { name: "Teal", accent: "#14b8a6", accent2: "#0f766e" },
  orange: { name: "Orange", accent: "#f97316", accent2: "#c2410c" },
  pink: { name: "Pink", accent: "#ec4899", accent2: "#be185d" },
};
const ACCENT_KEY = "bustaudio_accent";

// Read synchronously, before any screen builds its styles from `theme`, which
// is why a new accent applies when the app reloads.
export function storedAccent() {
  try {
    const key = SecureStore.getItem(ACCENT_KEY);
    return key && ACCENTS[key] ? key : "violet";
  } catch (_) {
    return "violet";
  }
}

export function saveAccent(key) {
  try {
    SecureStore.setItem(ACCENT_KEY, key);
  } catch (_) {
    /* keeps the current accent */
  }
}

export const appliedAccent = storedAccent();
const { accent, accent2 } = ACCENTS[appliedAccent];

export const theme = {
  bg: "#15101c",
  card: "#221a2e",
  border: "#3a3147",
  text: "#ece8f1",
  sub: "#a99fb8",
  dim: "#8f859e",
  accent,
  accent2,
  good: "#22c55e",
  warn: "#f59e0b",
  danger: "#f87171",
  gradient: [accent, accent2],
  coverGradient: ["#3d3157", "#241b33"],
  playerGradient: ["#2c2140", "#15101c"],
  headerGradient: ["#271d3a", "#15101c"],
};
