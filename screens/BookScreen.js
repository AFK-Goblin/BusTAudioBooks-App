import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { theme } from "../src/theme";
import { getStreams } from "../src/api";
import { loadBook } from "../src/player";
import { upsertBook, getBook } from "../src/library";
import { startDownload } from "../src/downloads";
import { CoverArt, GradientButton, PlayPauseIcon } from "../src/ui";
import { ChevronIcon, DownloadIcon } from "../src/icons";
import { useScreenPad } from "../src/layout";

export default function BookScreen({ nav, params }) {
  const item = params.item;
  const topPad = useScreenPad();
  const [state, setState] = useState({ loading: true });

  async function resolve() {
    setState({ loading: true });
    try {
      const r = await getStreams(item.id);
      setState({ loading: false, data: r });
    } catch (e) {
      setState({ loading: false, error: e.message || "Could not resolve" });
    }
  }
  useEffect(() => { resolve(); }, [item.id]);

  function bookObject(files) {
    return {
      id: item.id, title: item.title, author: item.author, poster: item.poster,
      format: item.format, files,
    };
  }

  async function playStream() {
    const files = (state.data.streams || []).map((s) => ({ title: s.title, url: s.url, filename: s.filename }));
    const existing = await getBook(item.id);
    const book = await upsertBook({ ...bookObject(files), progress: existing && existing.progress });
    const p = book.progress || {};
    await loadBook(book, p.trackIndex || 0, p.position || 0);
    nav.navigate("player");
  }

  async function download() {
    const files = (state.data.streams || []).map((s) => ({ title: s.title, url: s.url, filename: s.filename }));
    startDownload(bookObject(files), files); // runs in background, tracked globally
    nav.navigate("library");
  }

  const ready = state.data && state.data.ready;
  const fileCount = state.data && state.data.streams ? state.data.streams.length : 0;

  return (
    <ScrollView style={[styles.wrap, { paddingTop: topPad }]} contentContainerStyle={{ paddingBottom: 120 }}>
      <TouchableOpacity onPress={nav.goBack} style={styles.backRow}>
        <ChevronIcon dir="left" size={18} color={theme.accent} />
        <Text style={styles.back}>Back</Text>
      </TouchableOpacity>

      <View style={styles.head}>
        <CoverArt uri={item.poster} size={100} radius={10} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{item.title}</Text>
          {item.author ? <Text style={styles.author}>{item.author}</Text> : null}
          <Text style={styles.meta}>
            {[item.format, item.bitrate, item.sizeText].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </View>

      {state.loading ? (
        <View style={styles.box}><ActivityIndicator color={theme.accent} /><Text style={styles.boxTxt}>Resolving on TorBox…</Text></View>
      ) : state.error ? (
        <View style={styles.box}>
          <Text style={styles.warn}>{state.error}</Text>
          <TouchableOpacity style={styles.retry} onPress={resolve}><Text style={styles.retryTxt}>Retry</Text></TouchableOpacity>
        </View>
      ) : !ready ? (
        <View style={styles.box}>
          <Text style={styles.boxTxt}>{state.data.status || "Downloading to TorBox…"}</Text>
          <Text style={styles.dim}>Not cached yet — TorBox is fetching it. Try again shortly.</Text>
          <TouchableOpacity style={styles.retry} onPress={resolve}><Text style={styles.retryTxt}>Check again</Text></TouchableOpacity>
        </View>
      ) : (
        <View>
          <Text style={styles.dim}>{fileCount} file{fileCount === 1 ? "" : "s"} ready</Text>
          <GradientButton onPress={playStream} style={{ marginTop: 12 }}>
            <View style={styles.btnRow}>
              <PlayPauseIcon playing={false} size={14} />
              <Text style={styles.btnTxt}>Stream now</Text>
            </View>
          </GradientButton>
          <TouchableOpacity style={styles.btnAlt} onPress={download}>
            <View style={styles.btnRow}>
              <DownloadIcon size={15} color={theme.text} />
              <Text style={[styles.btnTxt, { color: theme.text }]}>Download for offline</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.hint}>Downloads keep going in the background — watch progress in your Library.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 14 },
  back: { color: theme.accent, fontSize: 16 },
  head: { flexDirection: "row", gap: 14, marginBottom: 20 },
  title: { color: theme.text, fontSize: 18, fontWeight: "700" },
  author: { color: theme.sub, marginTop: 2 },
  meta: { color: theme.dim, fontSize: 12, marginTop: 6 },
  box: { backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 18, alignItems: "center", gap: 8, marginTop: 10 },
  boxTxt: { color: theme.text, textAlign: "center" },
  dim: { color: theme.dim, fontSize: 13, textAlign: "center", marginTop: 4, marginBottom: 6 },
  warn: { color: theme.warn, textAlign: "center" },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  btnAlt: {
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 12,
    paddingVertical: 14, alignItems: "center", marginTop: 12,
  },
  btnTxt: { color: "#fff", fontWeight: "700", fontSize: 15 },
  retry: { marginTop: 10, paddingHorizontal: 18, paddingVertical: 8, backgroundColor: theme.accent, borderRadius: 8 },
  retryTxt: { color: "#fff", fontWeight: "600" },
  hint: { color: theme.dim, fontSize: 12, textAlign: "center", marginTop: 14 },
});
