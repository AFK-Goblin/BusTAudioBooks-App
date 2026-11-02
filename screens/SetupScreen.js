import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../src/theme";
import { parseInstallLink, savePrefix } from "../src/config";
import { health } from "../src/api";
import { GradientButton } from "../src/ui";

export default function SetupScreen({ nav }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const insets = useSafeAreaInsets();

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
      const offline = /^Can't reach/.test(e.message || "");
      setError(offline ? "Couldn't reach that server. Check the link and your connection." : e.message || "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
      <Text style={styles.h1}>BusTAudio</Text>
      <Text style={styles.sub}>Your books, ready wherever you listen.</Text>
      <View style={styles.steps}>
        <Text style={styles.step}>1. Open your BusTAudio server’s setup page.</Text>
        <Text style={styles.step}>2. Copy the install link, then paste it below.</Text>
        <Text style={styles.step}>3. Connect, find a book, and stream or download it.</Text>
      </View>

      <TextInput
        style={styles.input}
        placeholder="https://…/…/manifest.json"
        placeholderTextColor={theme.dim}
        autoCapitalize="none"
        autoCorrect={false}
        value={link}
        onChangeText={setLink}
        multiline
        accessibilityLabel="BusTAudio install link"
        editable={!busy}
      />
      <Text style={styles.hint}>
        The setup page ends in /configure. If someone else runs your server, ask them for your install link. Your connection is checked before it is saved.
      </Text>

      {error ? <Text style={styles.err} accessibilityLiveRegion="polite">{error}</Text> : null}

      <GradientButton onPress={connect} disabled={busy} style={{ marginTop: 22 }}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>Connect</Text>}
      </GradientButton>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  content: { flexGrow: 1, paddingHorizontal: 24, justifyContent: "center" },
  steps: { gap: 12, marginBottom: 24, padding: 16, backgroundColor: theme.card, borderRadius: 12 },
  step: { color: theme.text, lineHeight: 22 },
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
