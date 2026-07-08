// src/layout.js — shared layout metrics. The Android status bar is translucent
// (expo default), so screens pad below it themselves; the exact height comes
// from the OS instead of the old hardcoded 52/56px.
import { createContext, useContext } from "react";
import { StatusBar, Platform } from "react-native";

export const STATUS_PAD = Platform.OS === "android" ? StatusBar.currentHeight || 24 : 44;
export const TAB_BAR_HEIGHT = 58;

// App.js sets screenTopPad to a small value while an update banner is showing
// (the banner already clears the status bar), and STATUS_PAD + 12 otherwise.
export const LayoutContext = createContext({ screenTopPad: STATUS_PAD + 12 });

// Top padding a screen should apply to sit below the status bar / update banner.
export function useScreenPad() {
  return useContext(LayoutContext).screenTopPad;
}
