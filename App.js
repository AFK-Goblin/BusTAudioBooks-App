import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Linking, BackHandler, AppState } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import Constants from "expo-constants";
import TrackPlayer, { Event, State, usePlaybackState, useActiveTrack, useProgress } from "react-native-track-player";

import { theme } from "./src/theme";
import { getPrefix } from "./src/config";
import { setupPlayer, getCurrentBook, loadBook } from "./src/player";
import { updateProgress, continueListening } from "./src/library";
import { appVersion } from "./src/api";
import { cmpVersion } from "./src/version";
import { initSettings, getSettings } from "./src/settings";
import { resumePendingDownloads, sweepFinishedDownloads } from "./src/downloads";
import { PlayPauseIcon, CoverArt } from "./src/ui";
import { HomeIcon, LibraryIcon, SlidersIcon, ComicIcon } from "./src/icons";
import { STATUS_PAD, TAB_BAR_HEIGHT, LayoutContext } from "./src/layout";

import SetupScreen from "./screens/SetupScreen";
import SearchScreen from "./screens/SearchScreen";
import BookScreen from "./screens/BookScreen";
import PlayerScreen from "./screens/PlayerScreen";
import LibraryScreen from "./screens/LibraryScreen";
import SettingsScreen from "./screens/SettingsScreen";
import ComicsScreen from "./screens/ComicsScreen";
import ComicScreen from "./screens/ComicScreen";
import ReaderScreen from "./screens/ReaderScreen";

const SCREENS = {
  setup: SetupScreen,
  search: SearchScreen,
  book: BookScreen,
  player: PlayerScreen,
  library: LibraryScreen,
  settings: SettingsScreen,
  comics: ComicsScreen,
  comic: ComicScreen,
  reader: ReaderScreen,
};
const TAB_ROOTS = ["search", "comics", "library", "settings"];

export default function App() {
  const [booting, setBooting] = useState(true);
  const [stack, setStack] = useState([{ name: "search" }]);
  const [otaReady, setOtaReady] = useState(false);
  const [nativeUpdate, setNativeUpdate] = useState(null); // { apkUrl, latestVersion }
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const navigate = useCallback((name, params = {}) => setStack((s) => [...s, { name, params }]), []);
  const goBack = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback((name) => setStack([{ name }]), []);

  useEffect(() => {
    (async () => {
      await initSettings();
      try {
        await setupPlayer();
      } catch (e) {
        // surfaced on first playback if it fails
      }
      const prefix = await getPrefix();
      reset(prefix ? "search" : "setup");
      setBooting(false);
      // Finish downloads the OS carried on with while the app was dead, and
      // (if enabled) free the files of books that were listened to the end.
      if (getSettings().autoDeleteFinished) {
        await sweepFinishedDownloads().catch(() => {});
      }
      resumePendingDownloads().catch(() => {});
      // Auto-resume: load the most recent book paused, so the mini player is
      // one tap from where you left off.
      if (prefix && getSettings().autoResume) {
        try {
          const cont = await continueListening();
          const b = cont[0];
          if (b && b.files && b.files.length) {
            const p = b.progress || {};
            await loadBook(b, p.trackIndex || 0, p.position || 0, { play: false });
          }
        } catch (_) {
          /* stale stream URLs etc. — user can still resume manually */
        }
      }
    })();
  }, [reset]);

  // Android hardware back: pop the stack; from a non-home tab go Home;
  // only exit the app from Home itself.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const s = stackRef.current;
      if (s.length > 1) {
        goBack();
        return true;
      }
      const name = s[0] && s[0].name;
      if (name === "comics" || name === "library" || name === "settings") {
        reset("search");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [goBack, reset]);

  // Update checks — OTA (JS) first, then native (APK). Runs at cold start AND
  // whenever the app returns to the foreground (Android keeps apps in memory
  // for days, so launch-only checks leave updates unseen). Throttled to 1/hour.
  const lastUpdateCheck = useRef(0);
  const runUpdateCheck = useCallback(async () => {
    lastUpdateCheck.current = Date.now();
    // OTA (JS) update: silently fetch, then prompt with a Reload button.
    if (Updates.isEnabled) {
      try {
        const res = await Updates.checkForUpdateAsync();
        if (res.isAvailable) {
          await Updates.fetchUpdateAsync();
          setOtaReady(true);
          return; // an OTA reload supersedes the APK banner
        }
      } catch (_) {
        /* offline / no update server — ignore */
      }
    }
    // Native (APK) update: ask the backend if a newer APK exists.
    try {
      const prefix = await getPrefix();
      if (!prefix) return;
      const info = await appVersion();
      const mine = (Constants.expoConfig && Constants.expoConfig.version) || "0.0.0";
      if (info && info.apkUrl && info.latestVersion && cmpVersion(mine, info.latestVersion) < 0) {
        setNativeUpdate(info);
      }
    } catch (_) {
      /* not configured yet / offline — ignore */
    }
  }, []);

  useEffect(() => {
    if (booting) return;
    runUpdateCheck();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && Date.now() - lastUpdateCheck.current > 60 * 60 * 1000) {
        runUpdateCheck();
      }
    });
    return () => sub.remove();
  }, [booting, runUpdateCheck]);

  // Persist playback progress for Continue Listening.
  useEffect(() => {
    const subs = [
      TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, async (e) => {
        const b = getCurrentBook();
        if (!b) return;
        let idx = 0;
        try { idx = (await TrackPlayer.getActiveTrackIndex()) || 0; } catch (_) {}
        await updateProgress(b.id, {
          position: e.position,
          duration: e.duration,
          trackIndex: idx,
          finished: e.duration > 0 && e.position >= e.duration - 15 && idx >= (b.files.length - 1),
        });
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  if (booting) {
    return (
      <View style={styles.center}>
        <StatusBar style="light" />
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  const top = stack[stack.length - 1];
  const Screen = SCREENS[top.name] || SearchScreen;
  const nav = { navigate, goBack, reset, depth: stack.length };
  const bannerVisible = otaReady || !!nativeUpdate;
  const showTabs = TAB_ROOTS.includes(top.name);
  // The reader is immersive: no mini player (tabs already hide — "reader" isn't a tab root).
  const showMini = top.name !== "player" && top.name !== "setup" && top.name !== "reader";

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {otaReady && (
        <UpdateBar
          text="Update ready"
          action="Reload"
          onPress={() => Updates.reloadAsync().catch(() => {})}
        />
      )}
      {!otaReady && nativeUpdate && (
        <UpdateBar
          text={`New version ${nativeUpdate.latestVersion} available`}
          action="Download"
          onPress={() => Linking.openURL(nativeUpdate.apkUrl).catch(() => {})}
          onDismiss={() => setNativeUpdate(null)}
        />
      )}
      <LayoutContext.Provider value={{ screenTopPad: bannerVisible ? 12 : STATUS_PAD + 12 }}>
        <View style={{ flex: 1 }}>
          <Screen nav={nav} params={top.params || {}} />
          {showMini && <MiniPlayer nav={nav} />}
        </View>
      </LayoutContext.Provider>
      {showTabs && <TabBar current={top.name} onTab={(name) => top.name !== name && reset(name)} />}
    </View>
  );
}

function UpdateBar({ text, action, onPress, onDismiss }) {
  return (
    <View style={styles.updateBar}>
      <Text style={styles.updateText} numberOfLines={1}>{text}</Text>
      {onDismiss && (
        <TouchableOpacity onPress={onDismiss} style={styles.updateDismiss}>
          <Text style={styles.updateDismissTxt}>Later</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={onPress} style={styles.updateBtn}>
        <Text style={styles.updateBtnTxt}>{action}</Text>
      </TouchableOpacity>
    </View>
  );
}

const TABS = [
  { name: "search", label: "Home", Icon: HomeIcon },
  { name: "comics", label: "Comics", Icon: ComicIcon },
  { name: "library", label: "Library", Icon: LibraryIcon },
  { name: "settings", label: "Settings", Icon: SlidersIcon },
];

function TabBar({ current, onTab }) {
  return (
    <View style={styles.tabBar}>
      {TABS.map(({ name, label, Icon }) => {
        const active = current === name;
        const color = active ? theme.accent : theme.dim;
        return (
          <TouchableOpacity key={name} style={styles.tab} onPress={() => onTab(name)} activeOpacity={0.7}>
            <Icon size={22} color={color} />
            <Text style={[styles.tabLabel, { color }]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function MiniPlayer({ nav }) {
  const track = useActiveTrack();
  const playback = usePlaybackState();
  const progress = useProgress();
  if (!track) return null;
  const playing = playback.state === State.Playing;
  const book = getCurrentBook();
  const pct = progress.duration ? Math.min(100, (progress.position / progress.duration) * 100) : 0;
  return (
    <TouchableOpacity style={styles.mini} activeOpacity={0.85} onPress={() => nav.navigate("player")}>
      <View style={styles.miniRow}>
        <CoverArt uri={book && book.poster} size={42} radius={7} />
        <View style={{ flex: 1 }}>
          <Text style={styles.miniTitle} numberOfLines={1}>{(book && book.title) || track.title}</Text>
          <Text style={styles.miniSub} numberOfLines={1}>{track.title !== ((book && book.title) || "") ? track.title : track.artist || ""}</Text>
        </View>
        <TouchableOpacity
          onPress={() => (playing ? TrackPlayer.pause() : TrackPlayer.play())}
          style={styles.miniBtn}
        >
          <PlayPauseIcon playing={playing} size={15} />
        </TouchableOpacity>
      </View>
      <View style={styles.miniTrack}>
        <View style={[styles.miniFill, { width: `${pct}%` }]} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  mini: {
    position: "absolute", left: 8, right: 8, bottom: 8, backgroundColor: theme.card,
    borderRadius: 12, borderWidth: 1, borderColor: theme.border, overflow: "hidden",
  },
  miniRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10 },
  miniTitle: { color: theme.text, fontWeight: "600" },
  miniSub: { color: theme.dim, fontSize: 12 },
  miniBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" },
  miniTrack: { height: 3, backgroundColor: theme.border },
  miniFill: { height: 3, backgroundColor: theme.accent },
  tabBar: {
    flexDirection: "row", height: TAB_BAR_HEIGHT, backgroundColor: theme.card,
    borderTopWidth: 1, borderTopColor: theme.border,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3 },
  tabLabel: { fontSize: 11, fontWeight: "600" },
  updateBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: theme.accent, paddingHorizontal: 14, paddingTop: STATUS_PAD + 8, paddingBottom: 12,
  },
  updateText: { color: "#fff", fontWeight: "600", flex: 1 },
  updateDismiss: { paddingHorizontal: 8, paddingVertical: 6 },
  updateDismissTxt: { color: "#ffffffcc", fontWeight: "600" },
  updateBtn: { backgroundColor: "#ffffff", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  updateBtnTxt: { color: theme.accent, fontWeight: "700" },
});
