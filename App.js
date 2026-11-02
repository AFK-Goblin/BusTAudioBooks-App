import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Linking, BackHandler, AppState, Alert } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Updates from "expo-updates";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useIsPlaying, useActiveMediaItem, useProgress } from "@rntp/player";

import { theme } from "./src/theme";
import { getPrefix } from "./src/config";
import { setupPlayer, checkpointPlayback, closeBook, pause, play, seekBy, usePlaybackSnapshot, refreshCarBrowse } from "./src/player";
import { subscribe as subscribeDownloads } from "./src/downloadStore";
import { registerBackgroundCheck } from "./src/backgroundCheck";
import { appVersion } from "./src/api";
import { cmpVersion } from "./src/version";
import { getSettings, useSettings } from "./src/settings";
import { resumePendingDownloads, removeComicsData, sweepFinishedDownloads, sweepOrphanedDownloads } from "./src/downloads";
import { initializeApplication } from "./src/startup";
import { flushListening } from "./src/stats";
import { checkWaiting } from "./src/waiting";
import { useToast } from "./src/toast";
import { PlayPauseIcon, CoverArt, useClock } from "./src/ui";
import { formatTime } from "./src/format";
import { HomeIcon, LibraryIcon, SlidersIcon, JumpIcon } from "./src/icons";
import { STATUS_PAD, LayoutContext, tabBarMetrics } from "./src/layout";
import { AppErrorBoundary } from "./src/components/AppErrorBoundary";
import { WhatsNewSheet } from "./src/components/WhatsNewSheet";
import { StartupNotice } from "./src/components/StartupNotice";
import { whatsNewPending, markWhatsNewSeen } from "./src/whatsNew";

import SetupScreen from "./screens/SetupScreen";
import SearchScreen from "./screens/SearchScreen";
import BookScreen from "./screens/BookScreen";
import PlayerScreen from "./screens/PlayerScreen";
import LibraryScreen from "./screens/LibraryScreen";
import SettingsScreen from "./screens/SettingsScreen";
import StatsScreen from "./screens/StatsScreen";
import BookmarksScreen from "./screens/BookmarksScreen";
import CarScreen from "./screens/CarScreen";

const SCREENS = {
  setup: SetupScreen,
  search: SearchScreen,
  book: BookScreen,
  player: PlayerScreen,
  library: LibraryScreen,
  settings: SettingsScreen,
  stats: StatsScreen,
  bookmarks: BookmarksScreen,
  car: CarScreen,
};
// Screens that are themselves the player: no mini player on top of them.
const FULL_SCREEN = ["player", "car", "setup"];
const TAB_ROOTS = ["search", "library", "settings"];
const WAITING_CHECK_MS = 3 * 60 * 1000;

// Notifications that arrive while the app is open still show.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

function Application() {
  const insets = useSafeAreaInsets();
  const [booting, setBooting] = useState(true);
  const [startupWarnings, setStartupWarnings] = useState([]);
  const [stack, setStack] = useState([{ name: "search" }]);
  const [otaReady, setOtaReady] = useState(false);
  const [nativeUpdate, setNativeUpdate] = useState(null); // { apkUrl, latestVersion }
  const [whatsNew, setWhatsNew] = useState(false);
  const stackRef = useRef(stack);
  useEffect(() => { stackRef.current = stack; }, [stack]);

  const navigate = useCallback((name, params = {}) => setStack((s) => [...s, { name, params }]), []);
  const goBack = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback((name) => setStack([{ name }]), []);

  useEffect(() => {
    (async () => {
      const startup = await initializeApplication();
      const prefix = await getPrefix();
      reset(prefix ? "search" : "setup");
      setBooting(false);
      // After an update, once: what's new. A fresh install has nothing to compare.
      if (!prefix) markWhatsNewSeen();
      else if (await whatsNewPending()) setWhatsNew(true);
      // Housekeeping waits for the background start-up (download resume) so
      // it never races the jobs being re-attached.
      const warnings = await startup.background.catch(() => []);
      setStartupWarnings(warnings.filter((warning) => warning.stage === "player" || warning.stage === "downloads"));
      // Free the files of books that were listened to the end, if enabled.
      if (getSettings().autoDeleteFinished) {
        await sweepFinishedDownloads().catch(() => {});
      }
      // One-time: drop data left by the removed comics feature.
      await removeComicsData().catch(() => {});
      // Reclaim folders nothing owns (3.0.x left removed downloads on disk).
      await sweepOrphanedDownloads().catch(() => {});
      // Books waiting on TorBox that are ready by now start downloading.
      checkWaiting().catch(() => {});
      // Android Auto's list, and the check that runs while the app is closed.
      refreshCarBrowse().catch(() => {});
      registerBackgroundCheck().catch(() => {});
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
      if (name === "library" || name === "settings") {
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
      if (state === "background" || state === "inactive") {
        checkpointPlayback("app-background").catch(() => {});
        flushListening();
        refreshCarBrowse().catch(() => {});
      }
      if (state === "active" && Date.now() - lastUpdateCheck.current > 60 * 60 * 1000) {
        runUpdateCheck();
      }
      if (state === "active") checkWaiting().catch(() => {});
    });
    return () => sub.remove();
  }, [booting, runUpdateCheck]);

  // A finished download belongs in Android Auto's list right away.
  useEffect(() => {
    let count = 0;
    return subscribeDownloads((active) => {
      if (active.length < count) refreshCarBrowse().catch(() => {});
      count = active.length;
    });
  }, []);

  // Tapping a notification: "ready to download" opens the Library, "new in
  // your series" searches for the book.
  useEffect(() => {
    if (booting) return undefined;
    const open = (response) => {
      const data = (response && response.notification.request.content.data) || {};
      if (data.screen === "library") reset("library");
      else if (data.query) navigate("search", { query: data.query });
    };
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [booting, navigate, reset]);

  // While the app is open, look in on books waiting for TorBox now and then.
  useEffect(() => {
    if (booting) return undefined;
    const id = setInterval(() => {
      if (AppState.currentState === "active") checkWaiting().catch(() => {});
    }, WAITING_CHECK_MS);
    return () => clearInterval(id);
  }, [booting]);

  async function retryStartup(stage) {
    if (stage === "player") await setupPlayer();
    else if (stage === "downloads") await resumePendingDownloads();
  }
  const clearStartupWarning = (stage) => setStartupWarnings((warnings) => warnings.filter((warning) => warning.stage !== stage));

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
  const showMini = !FULL_SCREEN.includes(top.name);

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
      {startupWarnings.length > 0 ? <StartupNotice key={startupWarnings[0].stage} warning={startupWarnings[0]} onRetry={retryStartup} onResolve={clearStartupWarning} onDismiss={clearStartupWarning} topInset={bannerVisible ? 0 : STATUS_PAD} /> : null}
      <LayoutContext.Provider value={{ screenTopPad: bannerVisible || startupWarnings.length > 0 ? 12 : STATUS_PAD + 12 }}>
        <View style={{ flex: 1 }}>
          <Screen nav={nav} params={top.params || {}} />
          {showMini && <MiniPlayer nav={nav} />}
          <Toast raised={showMini} />
        </View>
      </LayoutContext.Provider>
      {showTabs && <TabBar current={top.name} bottomInset={insets.bottom} onTab={(name) => top.name !== name && reset(name)} />}
      <WhatsNewSheet visible={whatsNew} onClose={() => { setWhatsNew(false); markWhatsNewSeen(); }} />
    </View>
  );
}

export default function App() {
  return <SafeAreaProvider><AppErrorBoundary><Application /></AppErrorBoundary></SafeAreaProvider>;
}

// Above the mini player when it's showing.
function Toast({ raised }) {
  const toast = useToast();
  if (!toast) return null;
  return (
    <View style={[styles.toast, { bottom: raised ? 80 : 16 }]} pointerEvents="none" accessibilityLiveRegion="polite">
      <Text style={styles.toastTxt}>{toast.text}</Text>
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
  { name: "library", label: "Library", Icon: LibraryIcon },
  { name: "settings", label: "Settings", Icon: SlidersIcon },
];

function TabBar({ current, onTab, bottomInset }) {
  const metrics = tabBarMetrics(bottomInset);
  return (
    <View style={[styles.tabBar, metrics]}>
      {TABS.map(({ name, label, Icon }) => {
        const active = current === name;
        const color = active ? theme.accent : theme.dim;
        return (
          <TouchableOpacity
            key={name}
            style={styles.tab}
            onPress={() => onTab(name)}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
          >
            <View style={[styles.tabIcon, active && styles.tabIconActive]}>
              <Icon size={22} color={color} />
            </View>
            <Text style={[styles.tabLabel, { color }]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function MiniPlayer({ nav }) {
  const track = useActiveMediaItem();
  const playing = useIsPlaying();
  const progress = useProgress();
  const snapshot = usePlaybackSnapshot();
  const settings = useSettings();
  const sleep = snapshot.sleep || { mode: "off" };
  const now = useClock(sleep.mode === "timer");
  if (!track) return null;
  const sleepNote = sleep.mode === "timer" ? `Sleep ${formatTime(Math.max(0, (sleep.endsAt - now) / 1000))} · ` : sleep.mode === "end-of-track" ? "Sleep at end of part · " : "";
  const book = snapshot.book;
  const pct = progress.duration ? Math.min(100, (progress.position / progress.duration) * 100) : 0;
  const problem = snapshot.status === "error" ? "Playback stopped — open to retry" : snapshot.status === "reconnecting" ? "Reconnecting…" : null;
  const confirmClose = () =>
    Alert.alert("Close this book?", "Your place is saved — pick it up again from Continue Listening.", [
      { text: "Cancel", style: "cancel" },
      { text: "Close", onPress: () => closeBook().catch(() => {}) },
    ]);
  return (
    <TouchableOpacity
      style={styles.mini}
      activeOpacity={0.85}
      onPress={() => nav.navigate("player")}
      onLongPress={confirmClose}
      accessibilityRole="button"
      accessibilityLabel={`Now playing: ${(book && book.title) || track.title}. Opens the player`}
      accessibilityHint="Long-press to close this book"
    >
      <View style={styles.miniRow}>
        <CoverArt uri={book && book.poster} size={42} radius={7} />
        <View style={{ flex: 1 }}>
          <Text style={styles.miniTitle} numberOfLines={1}>{(book && book.title) || track.title}</Text>
          {problem ? (
            <Text style={[styles.miniSub, { color: theme.danger }]} numberOfLines={1}>{problem}</Text>
          ) : (
            <Text style={styles.miniSub} numberOfLines={1}>{sleepNote}{track.title !== ((book && book.title) || "") ? track.title : track.artist || ""}</Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => seekBy(-settings.jumpBack).catch(() => {})}
          accessibilityLabel={`Back ${settings.jumpBack} seconds`}
          style={styles.miniJump}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
        >
          <JumpIcon dir="back" seconds={settings.jumpBack} size={30} color={theme.text} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => (playing ? pause() : play())}
          accessibilityLabel={playing ? "Pause" : "Play"}
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
  miniJump: { paddingHorizontal: 2 },
  miniBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.button, alignItems: "center", justifyContent: "center" },
  miniTrack: { height: 3, backgroundColor: theme.border },
  miniFill: { height: 3, backgroundColor: theme.accent },
  tabBar: {
    flexDirection: "row", backgroundColor: theme.card,
    borderTopWidth: 1, borderTopColor: theme.border,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3 },
  tabLabel: { fontSize: 11, fontWeight: "600" },
  tabIcon: { paddingHorizontal: 16, paddingVertical: 3, borderRadius: 14 },
  tabIconActive: { backgroundColor: theme.accent + "29" },
  toast: {
    position: "absolute", left: 16, right: 16, backgroundColor: theme.text, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11, elevation: 10, shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8,
  },
  toastTxt: { color: theme.bg, fontWeight: "600", textAlign: "center" },
  updateBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: theme.button, paddingHorizontal: 14, paddingTop: STATUS_PAD + 8, paddingBottom: 12,
  },
  updateText: { color: "#fff", fontWeight: "600", flex: 1 },
  updateDismiss: { paddingHorizontal: 8, paddingVertical: 6 },
  updateDismissTxt: { color: "#ffffffcc", fontWeight: "600" },
  updateBtn: { backgroundColor: "#ffffff", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  updateBtnTxt: { color: theme.accent, fontWeight: "700" },
});
