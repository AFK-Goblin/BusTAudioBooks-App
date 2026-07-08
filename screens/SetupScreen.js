import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { theme } from "../src/theme";
import { parseInstallLink, savePrefix } from "../src/config";
import { health } from "../src/api";
import { GradientButton } from "../src/ui";

export default function SetupScreen({ nav }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function connect() {
    setError(null);
    const prefix = parseInstallLink(link);
    if (!prefix) {
      setError("That doesn't look like a BusTAudio install link.");
      return;
    }
    setBusy(true);
    try {
      // Validate reachability + token BEFORE saving, so a bad link never
      // becomes the stored server.
      const h = await health(prefix);
      if (h && h.torboxKeyValid === false) {
        setError("Connected, but your TorBox key looks invalid. Check the link.");
      } else {
        await savePrefix(prefix);
        nav.reset("search");
        return;
      }
    } catch (e) {
      setError(e.message || "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.h1}>BusTAudio</Text>
      <Text style={styles.sub}>Paste your BusTAudio install link to get started.</Text>

      <TextInput
        style={styles.input}
        placeholder="https://…/…/manifest.json"
        placeholderTextColor={theme.dim}
        autoCapitalize="none"
        autoCorrect={false}
        value={link}
        onChangeText={setLink}
        multiline
      />
      <Text style={styles.hint}>
        This is the same link you'd install in Stremio — get it from the server's /configure page.
      </Text>

      {error ? <Text style={styles.err}>{error}</Text> : null}

      <GradientButton onPress={connect} disabled={busy} style={{ marginTop: 22 }}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>Connect</Text>}
      </GradientButton>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, padding: 24, justifyContent: "center" },
  h1: { color: theme.text, fontSize: 30, fontWeight: "800", marginBottom: 4 },
  sub: { color: theme.sub, marginBottom: 24 },
  input: {
    backgroundColor: theme.card, color: theme.text, borderWidth: 1, borderColor: theme.border,
    borderRadius: 10, padding: 12, minHeight: 70, textAlignVertical: "top",
  },
  hint: { color: theme.dim, fontSize: 12, marginTop: 8 },
  err: { color: "#f87171", marginTop: 14 },
  btnTxt: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
