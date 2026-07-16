import React, { useEffect, useState, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Linking, ScrollView, Switch } from "react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { theme } from "../src/theme";
import { getPrefix, clearPrefix } from "../src/config";
import { appVersion } from "../src/api";
import { cmpVersion } from "../src/version";
import { formatBytes } from "../src/format";
import { useSettings, setSetting, SPEED_OPTIONS, JUMP_BACK_OPTIONS, JUMP_FORWARD_OPTIONS } from "../src/settings";
import { applyJumpIntervals, setRate } from "../src/player";
import { downloadsSizeBytes, deleteAllDownloads } from "../src/downloads";
import { clearComicCache, comicCacheSizeBytes } from "../src/comics";
import { clearDownloadFlags } from "../src/library";
import { useScreenPad } from "../src/layout";

export default function SettingsScreen({ nav }) {
  const version = (Constants.expoConfig && Constants.expoConfig.version) || "?";
  const settings = useSettings();
  const topPad = useScreenPad();
  const [server, setServer] = useState("");
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState(null);
  const [usage, setUsage] = useState(null); // bytes, or null while loading
  const [comicCache, setComicCache] = useState(null); // bytes of streamed-comic cache

  useEffect(() => {
    (async () => {
      const p = await getPrefix();
      if (p) {
        // Show host only, hide the config blob (which contains the key).
        try {
          const u = new URL(p);
          setServer(u.host);
        } catch (_) {
          setServer(p);
        }
      }
    })();
  }, []);

  const refreshUsage = useCallback(async () => {
    const [u, c] = await Promise.all([downloadsSizeBytes(), comicCacheSizeBytes()]);
    setUsage(u);
    setComicCache(c);
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
    } catch (e) {
      setStatus("Couldn't check right now. Try again later.");
    } finally {
      setChecking(false);
    }
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
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 90 }}>

        <Text style={styles.sectionHead}>Playback</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Default speed</Text>
          <ChipRow
            options={SPEED_OPTIONS}
            value={settings.speed}
            format={(v) => `${v}×`}
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
        </View>

        <Text style={styles.sectionHead}>Downloads</Text>
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
              <TouchableOpacity style={styles.inlineBtn} onPress={wipeDownloads}>
                <Text style={styles.inlineBtnTxt}>Delete all downloads</Text>
              </TouchableOpacity>
            </>
          )}
          {comicCache > 0 && (
            <>
              <Divider />
              <TouchableOpacity
                style={styles.inlineBtn}
                onPress={async () => { await clearComicCache(); refreshUsage(); }}
              >
                <Text style={styles.inlineBtnTxt}>
                  Clear comic cache ({formatBytes(comicCache)})
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <Text style={styles.sectionHead}>Server</Text>
        <View style={styles.card}>
          <Row label="Connected to" value={server || "—"} />
          <Divider />
          <TouchableOpacity style={styles.inlineBtn} onPress={changeServer}>
            <Text style={styles.inlineBtnTxt}>Change server / disconnect</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHead}>About</Text>
        <View style={styles.card}>
          <Row label="App version" value={version} />
          <Divider />
          <Row label="Update" value={Updates.updateId ? String(Updates.updateId).slice(0, 8) : "embedded"} />
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
    </View>
  );
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
  wrap: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
  brand: { color: theme.text, fontSize: 22, fontWeight: "800", marginBottom: 6 },
  sectionHead: { color: theme.sub, fontWeight: "700", fontSize: 13, textTransform: "uppercase", marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13, gap: 12 },
  rowLabel: { color: theme.sub },
  rowValue: { color: theme.text, fontWeight: "600", flexShrink: 1 },
  rowSub: { color: theme.dim, fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: theme.border },
  label: { color: theme.sub, marginTop: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 12 },
  chip: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 7 },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipTxt: { color: theme.sub, fontWeight: "600", fontSize: 13 },
  chipTxtActive: { color: "#fff" },
  inlineBtn: { paddingVertical: 13, alignItems: "flex-start" },
  inlineBtnTxt: { color: theme.warn, fontWeight: "600" },
  status: { color: theme.dim, textAlign: "center", marginTop: 12 },
  foot: { color: theme.dim, fontSize: 12, textAlign: "center", marginTop: 24, lineHeight: 18 },
});
