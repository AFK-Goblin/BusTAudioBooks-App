import React, { useEffect, useState, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, SectionList, Alert } from "react-native";
import { theme } from "../src/theme";
import { continueListening, downloadedBooks, finishedBooks, getBook, removeBook } from "../src/library";
import { deleteDownload, retryDownload } from "../src/downloads";
import { useDownloads, dismissTracking } from "../src/downloadStore";
import { loadBook } from "../src/player";
import { formatTime } from "../src/format";
import { CoverArt } from "../src/ui";
import { DotsIcon, NoteGlyph } from "../src/icons";
import { useScreenPad } from "../src/layout";

export default function LibraryScreen({ nav }) {
  const [sections, setSections] = useState([]);
  const downloads = useDownloads();
  const topPad = useScreenPad();

  const load = useCallback(async () => {
    const cont = await continueListening();
    const dls = await downloadedBooks();
    const fin = await finishedBooks();
    const s = [];
    if (cont.length) s.push({ title: "Continue Listening", data: cont, kind: "continue" });
    if (dls.length) s.push({ title: "Downloads", data: dls, kind: "download" });
    if (fin.length) s.push({ title: "Finished", data: fin, kind: "finished" });
    setSections(s);
  }, []);

  useEffect(() => { load(); }, [load]);
  // Reload the downloaded list whenever the active-download set changes (e.g. one finishes).
  useEffect(() => { load(); }, [downloads.length, load]);

  async function play(book, fromStart = false) {
    const fresh = (await getBook(book.id)) || book;
    if (!fresh.files || fresh.files.length === 0) {
      // Not downloaded and no cached stream URLs — send to detail to re-resolve.
      nav.navigate("book", { item: fresh });
      return;
    }
    const p = fromStart ? {} : fresh.progress || {};
    try {
      await loadBook(fresh, p.trackIndex || 0, p.position || 0);
      nav.navigate("player");
    } catch (e) {
      nav.navigate("book", { item: fresh });
    }
  }

  function confirmDelete(book) {
    Alert.alert("Remove download?", `Delete the downloaded files for "${book.title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => { await deleteDownload(book.id); await removeBook(book.id); load(); },
      },
    ]);
  }

  return (
    <View style={[styles.wrap, { paddingTop: topPad }]}>
      <Text style={styles.brand}>Library</Text>

      <SectionList
        sections={sections}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ paddingBottom: 90 }}
        ListHeaderComponent={
          downloads.length > 0 ? (
            <View>
              <Text style={styles.section}>Downloading</Text>
              {downloads.map((d) => (
                <View key={d.id} style={styles.dlRow}>
                  <CoverArt uri={d.poster} size={52} radius={6} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={2}>{d.title}</Text>
                    {d.status === "error" ? (
                      <View>
                        <Text style={styles.dlErr} numberOfLines={1}>Failed — {d.error || "download error"}</Text>
                        <View style={styles.errBtns}>
                          <TouchableOpacity style={styles.errBtn} onPress={() => retryDownload(d)}>
                            <Text style={styles.errBtnTxt}>Retry</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.errBtn, styles.errBtnAlt]} onPress={() => dismissTracking(d.id)}>
                            <Text style={[styles.errBtnTxt, { color: theme.dim }]}>Dismiss</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <>
                        <Text style={styles.meta}>
                          {d.count > 1 ? `File ${d.i + 1}/${d.count} · ` : ""}{d.pct}%
                        </Text>
                        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${d.pct}%` }]} /></View>
                      </>
                    )}
                  </View>
                </View>
              ))}
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
        ListEmptyComponent={
          downloads.length === 0 ? (
            <View style={styles.emptyBox}>
              <NoteGlyph size={38} color={theme.border} />
              <Text style={styles.empty}>Nothing here yet.{"\n"}Search for a book, then play it or download it for offline.</Text>
            </View>
          ) : null
        }
        renderItem={({ item, section }) => {
          const prog = item.progress || {};
          const pct = prog.duration ? Math.min(100, Math.round((prog.position / prog.duration) * 100)) : 0;
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => play(item, section.kind === "finished")}
              onLongPress={() => item.downloaded && confirmDelete(item)}
            >
              <CoverArt uri={item.poster} size={52} radius={6} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                {item.author ? <Text style={styles.author} numberOfLines={1}>{item.author}</Text> : null}
                <Text style={styles.meta}>
                  {section.kind === "continue"
                    ? `${formatTime(prog.position)} · ${pct}%`
                    : section.kind === "finished"
                      ? `Finished${item.downloaded ? " · Downloaded" : ""} — tap to listen again`
                      : item.downloaded ? "Downloaded" : ""}
                </Text>
              </View>
              {item.downloaded && (
                <TouchableOpacity style={styles.moreBtn} onPress={() => confirmDelete(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <DotsIcon size={18} color={theme.dim} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
  brand: { color: theme.text, fontSize: 22, fontWeight: "800", marginBottom: 10 },
  section: { color: theme.sub, fontWeight: "700", fontSize: 13, textTransform: "uppercase", marginTop: 18, marginBottom: 6 },
  row: { flexDirection: "row", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border, alignItems: "center" },
  dlRow: { flexDirection: "row", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border, alignItems: "center" },
  progressTrack: { height: 4, backgroundColor: theme.border, borderRadius: 2, marginTop: 6 },
  progressFill: { height: 4, backgroundColor: theme.accent, borderRadius: 2 },
  dlErr: { color: "#f87171", fontSize: 12, marginTop: 3 },
  errBtns: { flexDirection: "row", gap: 8, marginTop: 8 },
  errBtn: { backgroundColor: theme.accent, borderRadius: 7, paddingHorizontal: 12, paddingVertical: 5 },
  errBtnAlt: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.border },
  errBtnTxt: { color: "#fff", fontWeight: "600", fontSize: 12 },
  title: { color: theme.text, fontWeight: "600" },
  author: { color: theme.sub, fontSize: 13, marginTop: 1 },
  meta: { color: theme.dim, fontSize: 12, marginTop: 3 },
  moreBtn: { padding: 6 },
  emptyBox: { alignItems: "center", marginTop: 60, gap: 10, paddingHorizontal: 30 },
  empty: { color: theme.dim, textAlign: "center", lineHeight: 20 },
});
