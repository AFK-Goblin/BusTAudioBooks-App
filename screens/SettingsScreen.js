import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Linking, ScrollView, Switch, Share } from "react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { theme, ACCENTS, appliedAccent, storedAccent, saveAccent } from "../src/theme";
import { getPrefix, clearPrefix } from "../src/config";
import { appVersion, health } from "../src/api";
import { cmpVersion } from "../src/version";
import { formatBytes, formatSpeed } from "../src/format";
import {
  useSettings, setSetting, SPEED_OPTIONS, JUMP_BACK_OPTIONS, JUMP_FORWARD_OPTIONS, BEDTIME_START_OPTIONS, BEDTIME_MINUTE_OPTIONS,
  DAILY_GOAL_OPTIONS,
} from "../src/settings";
import { applyJumpIntervals, setRate } from "../src/player";
import { downloadsSizeBytes, deleteAllDownloads, downloadSizes } from "../src/downloads";
import { freeDownload } from "../src/freeDownload";
import { clearDownloadFlags } from "../src/library";
import { useScreenPad } from "../src/layout";
import { buildBackup, restoreBackup } from "../src/backup";
import { Sheet, CoverArt } from "../src/ui";
import { WhatsNewSheet } from "../src/components/WhatsNewSheet";
import { notificationsAllowed } from "../src/notify";

export default function SettingsScreen({ nav }) {
  const version = (Constants.expoConfig && Constants.expoConfig.version) || "?";
  const settings = useSettings();
  const topPad = useScreenPad();
  const [server, setServer] = useState("");
  const [checking, setChecking] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);
  const scroll = useRef(null);
  const sectionOffsets = useRef({});
  const [status, setStatus] = useState(null);
  const [usage, setUsage] = useState(null); // bytes, or null while loading
  const [restoring, setRestoring] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [accentChoice, setAccentChoice] = useState(storedAccent);
  const [whatsNew, setWhatsNew] = useState(false);
  const [sizes, setSizes] = useState(null); // "loading" | [{ entry, bytes }] while the manager is open

  useEffect(() => {
    (async () => {
      const p = await getPrefix();
      if (p) {
        // Show host only, hide the config blob (which contains the key).
        try {
          const u = new URL(p);
          setServer(u.host);
        } catch (_) {
          setServer("Saved connection");
        }
      }
    })();
  }, []);

  const refreshUsage = useCallback(async () => {
    setUsage(await downloadsSizeBytes());
  }, []);
  useEffect(() => { refreshUsage(); }, [refreshUsage]);

  async function setSpeed(v) {
    await setSetting("speed", v);
    // Apply immediately if something is playing.
    setRate(v).catch(() => {});
  }

  async function setJump(key, v) {
    await setSetting(key, v);
    applyJumpIntervals().catch(() => {});
  }

  // Downloads by size, so the biggest can go first.
  function manageDownloads() {
    setSizes("loading");
    downloadSizes().then(setSizes).catch(() => setSizes([]));
  }

  function confirmFree(entry) {
    Alert.alert("Delete download?", `Free the space used by "${entry.title}"? Your progress and bookmarks are kept.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          await freeDownload(entry.id);
          setSizes((list) => (Array.isArray(list) ? list.filter((item) => item.entry.id !== entry.id) : list));
          refreshUsage();
        },
      },
    ]);
  }

  function wipeDownloads() {
    Alert.alert(
      "Delete all downloads?",
      `This frees ${formatBytes(usage || 0) || "0 B"} of storage. Listening progress is kept.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete all", style: "destructive",
          onPress: async () => {
            await deleteAllDownloads();
            await clearDownloadFlags();
            refreshUsage();
          },
        },
      ]
    );
  }

  async function testConnection() {
    setTestingConnection(true);
    setConnectionStatus(null);
    try {
      const result = await health();
      setConnectionStatus(result && result.torboxKeyValid === false
        ? "Server reached, but the TorBox key is invalid. Replace your install link."
        : result && result.torboxKeyValid === true
          ? "Connected. Your server and TorBox key are ready."
          : "Server connected. This server does not report TorBox key status.");
    } catch (_) {
      setConnectionStatus("Could not connect. Check your connection and install link, then try again. Downloaded books still work offline.");
    } finally {
      setTestingConnection(false);
    }
  }

  async function checkUpdates() {
    setChecking(true);
    setStatus(null);
    try {
      // 1) OTA (JS) update
      if (Updates.isEnabled) {
        const res = await Updates.checkForUpdateAsync();
        if (res.isAvailable) {
          await Updates.fetchUpdateAsync();
          Alert.alert("Update ready", "A new version is ready. Reload now?", [
            { text: "Later", style: "cancel" },
            { text: "Reload", onPress: () => Updates.reloadAsync().catch(() => {}) },
          ]);
          return;
        }
      }
      // 2) Native (APK) update
      const info = await appVersion();
      if (info && info.apkUrl && info.latestVersion && cmpVersion(version, info.latestVersion) < 0) {
        Alert.alert(
          "New version available",
          `Version ${info.latestVersion} is available to download.`,
          [
            { text: "Later", style: "cancel" },
            { text: "Download", onPress: () => Linking.openURL(info.apkUrl).catch(() => {}) },
          ]
        );
        return;
      }
      setStatus("You're on the latest version.");
    } catch (_) {
      setStatus("Couldn't check right now. Try again later.");
    } finally {
      setChecking(false);
    }
  }

  async function shareBackup() {
    try {
      await Share.share({ title: "BusTAudio backup", message: await buildBackup() });
    } catch (e) {
      Alert.alert("Couldn't make a backup", e.message || "Try again.");
    }
  }

  async function runRestore() {
    try {
      const { added, updated } = await restoreBackup(restoreText);
      setRestoring(false);
      Alert.alert("Backup restored", `${added} book${added === 1 ? "" : "s"} added, ${updated} updated. Books play again once your server resolves them.`);
    } catch (e) {
      Alert.alert("Couldn't restore", e.message || "Something went wrong.");
    }
  }

  function pickAccent(key) {
    saveAccent(key);
    setAccentChoice(key);
  }

  function changeServer() {
    Alert.alert("Change server?", "This disconnects the app so you can paste a new install link.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect", style: "destructive",
        onPress: async () => { await clearPrefix(); nav.reset("setup"); },
      },
    ]);
  }

  return (
    <View style={[styles.wrap, { paddingTop: topPad }]}>
      <Text style={styles.brand}>Settings</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sectionNav} contentContainerStyle={{ gap: 8, paddingBottom: 10 }}>
        {["Playback", "Appearance", "Listening", "Notifications", "Downloads", "Backup", "Connection", "About"].map((section) => (
          <TouchableOpacity key={section} style={styles.sectionLink} accessibilityRole="button" accessibilityLabel={`Settings section: ${section}`} onPress={() => scroll.current?.scrollTo({ y: Math.max(0, (sectionOffsets.current[section] || 0) - 8), animated: true })}>
            <Text style={styles.sectionLinkText}>{section}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <ScrollView ref={scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 90 }}>

        <Text style={styles.sectionHead} accessibilityRole="header" onLayout={(event) => { sectionOffsets.current["Playback"] = event.nativeEvent.layout.y; }}>Playback</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Default speed</Text>
          <Text style={styles.labelSub}>For books you haven’t started — each book remembers its own speed.</Text>
          <ChipRow
            options={SPEED_OPTIONS.some((v) => Math.abs(v - settings.speed) < 0.001)
              ? SPEED_OPTIONS
              : [...SPEED_OPTIONS, settings.speed].sort((a, b) => a - b)}
            value={settings.speed}
            format={formatSpeed}
            onSelect={setSpeed}
          />
          <Divider />
          <Text style={styles.label}>Skip back</Text>
          <ChipRow
            options={JUMP_BACK_OPTIONS}
            value={settings.jumpBack}
            format={(v) => `${v}s`}
            onSelect={(v) => setJump("jumpBack", v)}
          />
          <Divider />
          <Text style={styles.label}>Skip forward</Text>
          <ChipRow
            options={JUMP_FORWARD_OPTIONS}
            value={settings.jumpForward}
            format={(v) => `${v}s`}
            onSelect={(v) => setJump("jumpForward", v)}
          />
          <Divider />
          <SwitchRow
            label="Load last book on launch"
            sub="Opens the app ready to resume where you left off"
            value={!!settings.autoResume}
            onChange={(v) => setSetting("autoResume", v)}
          />
          <Divider />
          <SwitchRow
            label="Smart rewind"
            sub="Step back a few seconds when you resume after a pause — the longer the pause, the more (up to 20 s), and a full minute after a sleep timer"
            value={settings.smartRewind !== false}
            onChange={(v) => setSetting("smartRewind", v)}
          />
          <Divider />
          <SwitchRow
            label="Fade out sleep timer"
            sub="Lower the volume over a timer's last 30 seconds instead of stopping abruptly"
            value={settings.sleepFade !== false}
            onChange={(v) => setSetting("sleepFade", v)}
          />
          <Divider />
          <SwitchRow
            label="Bedtime sleep timer"
            sub={`Start a ${settings.bedtimeMinutes || 30}-minute sleep timer whenever you start listening between ${hourLabel(settings.bedtimeStart ?? 22)} and 6 am`}
            value={!!settings.bedtimeTimer}
            onChange={(v) => setSetting("bedtimeTimer", v)}
          />
          {settings.bedtimeTimer ? (
            <>
              <Text style={styles.label}>Starting at</Text>
              <ChipRow
                options={BEDTIME_START_OPTIONS}
                value={settings.bedtimeStart ?? 22}
                format={hourLabel}
                onSelect={(v) => setSetting("bedtimeStart", v)}
              />
              <Text style={styles.label}>Timer length</Text>
              <ChipRow
                options={BEDTIME_MINUTE_OPTIONS}
                value={settings.bedtimeMinutes || 30}
                format={(v) => `${v} min`}
                onSelect={(v) => setSetting("bedtimeMinutes", v)}
              />
            </>
          ) : null}
        </View>

        <Text style={styles.sectionHead} accessibilityRole="header" onLayout={(event) => { sectionOffsets.current["Appearance"] = event.nativeEvent.layout.y; }}>Appearance</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Accent colour</Text>
          <View style={styles.swatches}>
            {Object.entries(ACCENTS).map(([key, a]) => {
              const active = accentChoice === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={styles.swatchWrap}
                  onPress={() => pickAccent(key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${a.name} accent`}
                  accessibilityState={{ selected: active }}
                >
                  <View style={[styles.swatch, { backgroundColor: a.accent }, active && styles.swatchActive]} />
                  <Text style={[styles.swatchTxt, active && { color: theme.text }]}>{a.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {accentChoice !== appliedAccent ? (
            <>
              <Divider />
              <TouchableOpacity style={styles.inlineBtn} onPress={() => Updates.reloadAsync().catch(() => {})}>
                <Text style={[styles.inlineBtnTxt, { color: ACCENTS[accentChoice].accent }]}>Restart the app to apply {ACCENTS[accentChoice].name}</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </View>

        <Text style={styles.sectionHead} accessibilityRole="header" onLayout={(event) => { sectionOffsets.current["Listening"] = event.nativeEvent.layout.y; }}>Listening</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Daily goal</Text>
          <Text style={styles.labelSub}>Minutes a day to aim for — tracked in your listening stats and Library.</Text>
          <ChipRow
            options={DAILY_GOAL_OPTIONS}
            value={settings.dailyGoal || 0}
            format={(v) => (v ? `${v} min` : "Off")}
            onSelect={(v) => setSetting("dailyGoal", v)}
          />
          <Divider />
          <TouchableOpacity style={styles.inlineBtn} onPress={() => nav.navigate("stats")}>
            <Text style={[styles.inlineBtnTxt, { color: theme.accent }]}>Listening stats ›</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHead} accessibilityRole="header" onLayout={(event) => { sectionOffsets.current["Notifications"] = event.nativeEvent.layout.y; }}>Notifications</Text>
        <View style={styles.card}>
          <SwitchRow
            label="Ready on TorBox"
            sub="When a book you chose to download when ready has been fetched (the app checks about every half hour)"
            value={settings.notifyReady !== false}
            onChange={(v) => { setSetting("notifyReady", v); if (v) notificationsAllowed(true).catch(() => {}); }}
          />
          <Divider />
          <SwitchRow
            label="New books in your series"
            sub="When the next book of a series you're listening to comes out (checked once a day)"
            value={settings.notifyReleases !== false}
            onChange={(v) => { setSetting("notifyReleases", v); if (v) notificationsAllowed(true).catch(() => {}); }}
          />
        </View>

        <Text style={styles.sectionHead} accessibilityRole="header" onLayout={(event) => { sectionOffsets.current["Downloads"] = event.nativeEvent.layout.y; }}>Downloads</Text>
        <View style={styles.card}>
          <SwitchRow
            label="Wi-Fi only"
            sub="Never download over mobile data"
            value={!!settings.wifiOnly}
            onChange={(v) => setSetting("wifiOnly", v)}
          />
          <Divider />
          <SwitchRow
            label="Auto-delete finished"
            sub="Free the files of finished books on next launch (progress is kept)"
            value={!!settings.autoDeleteFinished}
            onChange={(v) => setSetting("autoDeleteFinished", v)}
          />
          <Divider />
          <Row label="Storage used" value={usage == null ? "…" : formatBytes(usage) || "0 B"} />
          {usage > 0 && (
            <>
              <Divider />
              <TouchableOpacity style={styles.inlineBtn} onPress={manageDownloads}>
                <Text style={[styles.inlineBtnTxt, { color: theme.accent }]}>Manage downloads ›</Text>
              </TouchableOpacity>
              <Divider />
              <TouchableOpacity style={styles.inlineBtn} onPress={wipeDownloads}>
                <Text style={styles.inlineBtnTxt}>Delete all downloads</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <Text style={styles.sectionHead} accessibilityRole="header" onLayout={(event) => { sectionOffsets.current["Backup"] = event.nativeEvent.layout.y; }}>Backup</Text>
        <View style={styles.card}>
          <Text style={styles.cardNote}>
            Your progress, bookmarks and stats live only on this phone. Save a backup to Drive, email or notes,
            and paste it back in after a reinstall or on a new phone.
          </Text>
          <Divider />
          <TouchableOpacity style={styles.inlineBtn} onPress={shareBackup}>
            <Text style={[styles.inlineBtnTxt, { color: theme.accent }]}>Back up library…</Text>
          </TouchableOpacity>
          <Divider />
          <TouchableOpacity style={styles.inlineBtn} onPress={() => { setRestoreText(""); setRestoring(true); }}>
            <Text style={[styles.inlineBtnTxt, { color: theme.accent }]}>Restore from a backup…</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHead} accessibilityRole="header" onLayout={(event) => { sectionOffsets.current["Connection"] = event.nativeEvent.layout.y; }}>Connection</Text>
        <View style={styles.card}>
          <Row label="Connected to" value={server || "—"} />
          <Divider />
          <TouchableOpacity style={styles.inlineBtn} onPress={testConnection} disabled={testingConnection} accessibilityRole="button" accessibilityState={{ busy: testingConnection, disabled: testingConnection }}>
            {testingConnection ? <ActivityIndicator color={theme.accent} /> : <Text style={[styles.inlineBtnTxt, { color: theme.accent }]}>Test connection</Text>}
          </TouchableOpacity>
          {connectionStatus ? <Text style={styles.cardNote} accessibilityLiveRegion="polite">{connectionStatus}</Text> : null}
          <Divider />
          <TouchableOpacity style={styles.inlineBtn} onPress={changeServer}>
            <Text style={styles.inlineBtnTxt}>Change server / disconnect</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHead} accessibilityRole="header" onLayout={(event) => { sectionOffsets.current["About"] = event.nativeEvent.layout.y; }}>About</Text>
        <View style={styles.card}>
          <Row label="App version" value={version} />
          <Divider />
          <Row label="Update" value={Updates.updateId ? String(Updates.updateId).slice(0, 8) : "embedded"} />
          <Divider />
          <TouchableOpacity style={styles.inlineBtn} onPress={() => setWhatsNew(true)}>
            <Text style={[styles.inlineBtnTxt, { color: theme.accent }]}>{"What's new"}</Text>
          </TouchableOpacity>
          <Divider />
          <TouchableOpacity style={styles.inlineBtn} onPress={checkUpdates} disabled={checking}>
            {checking
              ? <ActivityIndicator color={theme.accent} size="small" />
              : <Text style={[styles.inlineBtnTxt, { color: theme.accent }]}>Check for updates</Text>}
          </TouchableOpacity>
        </View>
        {status ? <Text style={styles.status}>{status}</Text> : null}

        <Text style={styles.foot}>
          Everything streams and downloads through your own TorBox account. Your key stays in your
          install link on this device.
        </Text>
      </ScrollView>

      <WhatsNewSheet visible={whatsNew} onClose={() => setWhatsNew(false)} />

      <Sheet visible={sizes != null} onClose={() => setSizes(null)} title="Downloads by size" maxHeight={480}>
        {sizes === "loading" ? <ActivityIndicator color={theme.accent} style={{ marginVertical: 20 }} /> : null}
        {Array.isArray(sizes) && sizes.length === 0 ? <Text style={styles.sheetNote}>No downloaded books.</Text> : null}
        {(Array.isArray(sizes) ? sizes : []).map(({ entry, bytes }) => (
          <View key={entry.id} style={styles.dlRow}>
            <CoverArt uri={entry.poster} size={40} radius={6} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowValue} numberOfLines={1}>{entry.title}</Text>
              <Text style={styles.rowSub}>
                {formatBytes(bytes) || "0 B"}{entry.progress && entry.progress.finished ? " · finished" : ""}
              </Text>
            </View>
            <TouchableOpacity onPress={() => confirmFree(entry)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={`Delete download of ${entry.title}`}>
              <Text style={styles.deleteTxt}>Delete</Text>
            </TouchableOpacity>
          </View>
        ))}
      </Sheet>

      <Sheet visible={restoring} onClose={() => setRestoring(false)} title="Restore from a backup">
        <Text style={styles.sheetNote}>
          Paste the whole backup text. Books you already have keep whichever progress is newer; bookmarks are combined.
        </Text>
        <TextInput
          style={styles.restoreInput}
          value={restoreText}
          onChangeText={setRestoreText}
          placeholder='{"format":"bustaudio-backup", …}'
          placeholderTextColor={theme.dim}
          multiline
          autoCorrect={false}
          autoCapitalize="none"
        />
        <TouchableOpacity style={[styles.restoreBtn, !restoreText.trim() && { opacity: 0.4 }]} disabled={!restoreText.trim()} onPress={runRestore}>
          <Text style={styles.restoreBtnTxt}>Restore</Text>
        </TouchableOpacity>
      </Sheet>
    </View>
  );
}

function hourLabel(hour) {
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function SwitchRow({ label, sub, value, onChange }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowValue}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: theme.border, true: theme.accent2 }}
        thumbColor={value ? theme.accent : theme.sub}
      />
    </View>
  );
}

function ChipRow({ options, value, format, onSelect }) {
  return (
    <View style={styles.chipRow}>
      {options.map((v) => {
        const active = Math.abs(v - value) < 0.001;
        return (
          <TouchableOpacity
            key={String(v)}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onSelect(v)}
          >
            <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{format(v)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  sectionNav: { flexGrow: 0 },
  sectionLink: { minHeight: 48, paddingHorizontal: 14, borderRadius: 24, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, justifyContent: "center" },
  sectionLinkText: { color: theme.sub, fontWeight: "600" },
  wrap: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
  brand: { color: theme.text, fontSize: 22, fontWeight: "800", marginBottom: 6 },
  sectionHead: { color: theme.sub, fontWeight: "700", fontSize: 13, textTransform: "uppercase", marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13, gap: 12 },
  rowLabel: { color: theme.sub },
  rowValue: { color: theme.text, fontWeight: "600", flexShrink: 1 },
  rowSub: { color: theme.dim, fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: theme.border },
  swatches: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 14 },
  swatchWrap: { alignItems: "center", gap: 6, minWidth: 52 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: "transparent" },
  swatchActive: { borderColor: "#fff", transform: [{ scale: 1.1 }] },
  swatchTxt: { color: theme.dim, fontSize: 11, fontWeight: "600" },
  label: { color: theme.sub, marginTop: 12 },
  labelSub: { color: theme.dim, fontSize: 12, marginTop: 2 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 12 },
  chip: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 7 },
  chipActive: { backgroundColor: theme.button, borderColor: theme.accent },
  chipTxt: { color: theme.sub, fontWeight: "600", fontSize: 13 },
  chipTxtActive: { color: "#fff" },
  inlineBtn: { minHeight: 48, paddingVertical: 13, alignItems: "flex-start" },
  inlineBtnTxt: { color: theme.warn, fontWeight: "600" },
  cardNote: { color: theme.dim, fontSize: 12, lineHeight: 17, paddingVertical: 12 },
  sheetNote: { color: theme.dim, fontSize: 12, marginBottom: 10, paddingHorizontal: 4 },
  restoreInput: {
    color: theme.text, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 10,
    padding: 12, height: 140, textAlignVertical: "top", fontSize: 12, marginHorizontal: 4,
  },
  restoreBtn: { backgroundColor: theme.button, borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 12, marginHorizontal: 4 },
  restoreBtnTxt: { color: "#fff", fontWeight: "700" },
  status: { color: theme.dim, textAlign: "center", marginTop: 12 },
  dlRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: theme.border },
  deleteTxt: { color: theme.danger, fontWeight: "700" },
  foot: { color: theme.dim, fontSize: 12, textAlign: "center", marginTop: 24, lineHeight: 18 },
});
