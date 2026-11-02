import React, { useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { theme } from "../theme";

// The application keeps failed startup stages until a retry succeeds or the
// listener dismisses them. Never display raw native errors or stream URLs here.
export function StartupNotice({ warning, onRetry, onResolve, onDismiss, topInset = 0 }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!warning) return null;
  const player = warning.stage === "player";
  async function retry() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onRetry(warning.stage);
      onResolve(warning.stage);
    } catch (_) {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={[styles.notice, { paddingTop: topInset + 8 }]}>
      <View style={styles.message} accessibilityLiveRegion="polite">
        <Text style={styles.title}>{player ? "Audio player could not start" : "Downloads could not resume"}</Text>
        {failed ? <Text style={styles.detail}>Still unavailable. Try again in a moment.</Text> : null}
      </View>
      <TouchableOpacity style={styles.retry} onPress={retry} disabled={busy} accessibilityRole="button" accessibilityLabel={`Retry ${player ? "audio player" : "downloads"}`} accessibilityState={{ busy, disabled: busy }}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.retryText}>Retry</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.dismiss} onPress={() => onDismiss(warning.stage)} disabled={busy} accessibilityRole="button" accessibilityLabel="Dismiss startup notice">
        <Text style={styles.detail}>Later</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, paddingHorizontal: 12, paddingBottom: 8, backgroundColor: theme.card, borderBottomWidth: 1, borderColor: theme.border },
  message: { flex: 1, minWidth: 120 },
  title: { color: theme.text, fontSize: 14, fontWeight: "600" },
  detail: { color: theme.sub, fontSize: 13 },
  retry: { minWidth: 56, minHeight: 48, alignItems: "center", justifyContent: "center", backgroundColor: theme.button, borderRadius: 10, paddingHorizontal: 12 },
  retryText: { color: "#fff", fontWeight: "700" },
  dismiss: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
});
