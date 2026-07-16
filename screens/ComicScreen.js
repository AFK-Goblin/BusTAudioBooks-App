// screens/ComicScreen.js — comic detail/resolve screen (the comics BookScreen).
//
// Three ways a comic opens, all funneling into the reader:
//   • offline  — entry.files hold downloaded archives/pages → ensureExtracted
//   • archives — TorBox streams are .cbz/.cbr/… → "Read" downloads + extracts
//                one archive into cache with a "Preparing…" progress state
//   • images   — the torrent is loose page images → stream the URLs directly
import React, { useEffect, useState, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { theme } from "../src/theme";
import { getStreams } from "../src/api";
import { upsertBook, getBook } from "../src/library";
import { startDownload } from "../src/downloads";
import {
  classifyStreams, isReadable, prepareArchiveFromUrl, ensureExtracted,
} from "../src/comics";
import { CoverArt, GradientButton } from "../src/ui";
import { ChevronIcon, DownloadIcon, ComicIcon } from "../src/icons";
import { useScreenPad } from "../src/layout";

export default function ComicScreen({ nav, params }) {
  const item = params.item;
  const topPad = useScreenPad();
  const [entry, setEntry] = useState(null); // library entry, when one exists
  const [state, setState] = useState({ loading: true });
  const [preparing, setPreparing] = useState(null); // { label }

  // "Preparing" can outlive the screen (user backs out mid-download) — don't
  // setState on an unmounted component.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const offline = entry && entry.downloaded && entry.files && entry.files.length > 0;

  async function resolve() {
    setState({ loading: true });
    const existing = await getBook(item.id);
    setEntry(existing);
    if (existing && existing.downloaded && existing.files && existing.files.length > 0) {
      // Fully offline — no need to touch the network at all.
      setState({ loading: false });
      return;
    }
    try {
      const r = await getStreams(item.id);
      if (alive.current) setState({ loading: false, data: r });
    } catch (e) {
      if (alive.current) setState({ loading: false, error: e.message || "Could not resolve" });
    }
  }
  useEffect(() => { resolve(); }, [item.id]);

  function comicObject(files) {
    return {
      id: item.id, type: "comic", title: item.title, author: item.author,
      poster: item.poster, format: item.format, files,
    };
  }

  // LibraryScreen passes resume:false for "read again" (Finished section) —
  // anything else resumes at the saved page.
  const fromStart = params.resume === false;

  async function openReader(pages) {
    const existing = await getBook(item.id);
    const saved = await upsertBook({
      ...comicObject(existing ? existing.files || [] : []),
      progress: existing && existing.progress,
    });
    const startPage = fromStart ? 0 : (saved.progress && saved.progress.page) || 0;
    nav.navigate("reader", { entry: saved, pages, startPage });
  }

  async function readArchive(stream) {
    setPreparing({ label: "Preparing…" });
    try {
      const { pages } = await prepareArchiveFromUrl(comicObject([]), stream, (p) => {
        if (!alive.current) return;
        if (p.phase === "download") {
          const pct = p.total ? Math.round((p.written / p.total) * 100) : null;
          setPreparing({ label: pct != null ? `Downloading… ${pct}%` : "Downloading…" });
        } else {
          setPreparing({ label: "Extracting pages…" });
        }
      });
      if (!alive.current) return;
      setPreparing(null);
      await openReader(pages);
    } catch (e) {
      if (!alive.current) return;
      setPreparing(null);
      setState((s) => ({ ...s, error: e.message || "Couldn't open this archive" }));
    }
  }

  async function readImages(images) {
    await openReader(images.map((s) => s.url));
  }

  async function readOffline(fileIndex) {
    setPreparing({ label: "Opening…" });
    try {
      const { pages } = await ensureExtracted(entry, fileIndex);
      if (!alive.current) return;
      setPreparing(null);
      const startPage = fromStart ? 0 : (entry.progress && entry.progress.page) || 0;
      nav.navigate("reader", { entry, pages, startPage });
    } catch (e) {
      if (!alive.current) return;
      setPreparing(null);
      setState((s) => ({ ...s, error: e.message || "Couldn't open this download" }));
    }
  }

  function download(streams) {
    const files = streams.map((s) => ({ title: s.title, url: s.url, filename: s.filename }));
    startDownload(comicObject(files), files); // background, tracked in Library
    nav.navigate("library");
  }

  const plan = state.data && state.data.ready ? classifyStreams(state.data.streams) : null;

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
            {["Comic", item.format, item.sizeText].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </View>

      {preparing ? (
        <View style={styles.box}>
          <ActivityIndicator color={theme.accent} />
          <Text style={styles.boxTxt}>{preparing.label}</Text>
          <Text style={styles.dim}>Big volumes can take a minute — pages open as soon as they're ready.</Text>
        </View>
      ) : state.loading ? (
        <View style={styles.box}><ActivityIndicator color={theme.accent} /><Text style={styles.boxTxt}>Resolving on TorBox…</Text></View>
      ) : state.error ? (
        <View style={styles.box}>
          <Text style={styles.warn}>{state.error}</Text>
          <TouchableOpacity style={styles.retry} onPress={resolve}><Text style={styles.retryTxt}>Retry</Text></TouchableOpacity>
        </View>
      ) : offline ? (
        <View>
          <Text style={styles.dim}>Downloaded — reads offline</Text>
          {entry.files.map((f, i) => {
            const name = f.title || f.filename || `File ${i + 1}`;
            const readable = !!(f.pages && f.pages.length) || isReadable({ filename: f.uri });
            return (
              <View key={i} style={styles.fileRow}>
                <ComicIcon size={20} color={theme.sub} />
                <Text style={styles.fileName} numberOfLines={2}>{name}</Text>
                {readable ? (
                  <TouchableOpacity style={styles.readBtn} onPress={() => readOffline(i)}>
                    <Text style={styles.readBtnTxt}>Read</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.cbrNote}>Not readable in-app</Text>
                )}
              </View>
            );
          })}
        </View>
      ) : !(state.data && state.data.ready) ? (
        <View style={styles.box}>
          <Text style={styles.boxTxt}>{(state.data && state.data.status) || "Downloading to TorBox…"}</Text>
          <Text style={styles.dim}>Not cached yet — TorBox is fetching it. Try again shortly.</Text>
          <TouchableOpacity style={styles.retry} onPress={resolve}><Text style={styles.retryTxt}>Check again</Text></TouchableOpacity>
        </View>
      ) : plan.archives.length === 0 && plan.images.length === 0 ? (
        // Nothing readable came back — usually an old server that ignored
        // type=comic and returned audio files, or a torrent with no comic files.
        <View style={styles.box}>
          <Text style={styles.boxTxt}>No readable comic files in this torrent.</Text>
          <Text style={styles.dim}>
            If every comic shows this, your BusTAudio server may be out of date — comics need the 2.0 server.
          </Text>
        </View>
      ) : plan.mode === "images" ? (
        <View>
          <Text style={styles.dim}>{plan.images.length} page{plan.images.length === 1 ? "" : "s"} ready to stream</Text>
          <GradientButton onPress={() => readImages(plan.images)} style={{ marginTop: 12 }}>
            <View style={styles.btnRow}>
              <ComicIcon size={16} color="#fff" />
              <Text style={styles.btnTxt}>Read now</Text>
            </View>
          </GradientButton>
          <TouchableOpacity style={styles.btnAlt} onPress={() => download(plan.images)}>
            <View style={styles.btnRow}>
              <DownloadIcon size={15} color={theme.text} />
              <Text style={[styles.btnTxt, { color: theme.text }]}>Download for offline</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.hint}>Downloads keep going in the background — watch progress in your Library.</Text>
        </View>
      ) : (
        <View>
          <Text style={styles.dim}>{plan.archives.length} archive{plan.archives.length === 1 ? "" : "s"} available</Text>
          {plan.archives.map((s, i) => (
            <View key={i} style={styles.fileRow}>
              <ComicIcon size={20} color={theme.sub} />
              <View style={{ flex: 1 }}>
                <Text style={styles.fileName} numberOfLines={2}>{s.filename || s.title}</Text>
                {!isReadable(s) && <Text style={styles.cbrNote}>CBR — not readable in-app, download only</Text>}
              </View>
              {isReadable(s) && (
                <TouchableOpacity style={styles.readBtn} onPress={() => readArchive(s)}>
                  <Text style={styles.readBtnTxt}>Read</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          <TouchableOpacity style={styles.btnAlt} onPress={() => download(plan.archives)}>
            <View style={styles.btnRow}>
              <DownloadIcon size={15} color={theme.text} />
              <Text style={[styles.btnTxt, { color: theme.text }]}>
                Download {plan.archives.length === 1 ? "for offline" : "all for offline"}
              </Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.hint}>"Read" streams a copy into cache; downloads live in your Library for offline reading.</Text>
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
  fileRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
    borderRadius: 12, padding: 12, marginTop: 8,
  },
  fileName: { color: theme.text, flex: 1, fontSize: 13 },
  readBtn: { backgroundColor: theme.accent, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  readBtnTxt: { color: "#fff", fontWeight: "700" },
  cbrNote: { color: theme.dim, fontSize: 11, marginTop: 2 },
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
