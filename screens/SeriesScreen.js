// screens/SeriesScreen.js — MangaDex series detail: the chapter list.
//
// The torrent ComicScreen resolves one torrent into files; this screen's unit
// is the CHAPTER. It loads the full (server-filtered) chapter list, shows
// read-checkmarks and per-chapter Read/Download, and a Continue button that
// resumes the saved chapter+page. Reading progress lives on ONE series entry
// in the library; each downloaded chapter is its own small library entry
// (kind:"chapter") so the existing download engine works untouched.
import React, { useEffect, useState, useRef } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, Alert,
} from "react-native";
import { theme } from "../src/theme";
import { getChapters, getPages } from "../src/api";
import { getBook, upsertBook, listBooks } from "../src/library";
import { getSettings } from "../src/settings";
import { startDownload, downloadBook } from "../src/downloads";
import { useDownloads } from "../src/downloadStore";
import { sortPages } from "../src/comics";
import { CoverArt, GradientButton } from "../src/ui";
import { ChevronIcon, DownloadIcon, CheckIcon, ComicIcon } from "../src/icons";
import { useScreenPad } from "../src/layout";

const CHAPTER_PAGE = 100;

// Chapter lists survive unmount (returning from the reader remounts this
// screen); mirrors SearchScreen's module-cache pattern. TTL matches the
// server's feed cache so both refresh on the same rhythm.
const seriesCache = new Map(); // item.id -> { chapters, ts }
const SERIES_TTL = 10 * 60 * 1000;

export default function SeriesScreen({ nav, params }) {
  const item = params.item; // search result or library series entry
  const topPad = useScreenPad();
  const [entry, setEntry] = useState(null); // series library entry (progress, readChapters)
  const [chapters, setChapters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadNote, setLoadNote] = useState("");
  const [error, setError] = useState(null);
  const [opening, setOpening] = useState(null); // chapter id being opened
  const [dlByChapter, setDlByChapter] = useState({}); // chapterId -> chapter entry
  const [bulk, setBulk] = useState(null); // { done, total, failed } while downloading all
  const cancelBulk = useRef(false);
  const downloads = useDownloads();
  const downloadingIds = new Set(downloads.map((d) => d.id));

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const autoResumed = useRef(false);

  const mangaId = item.mangaId;

  async function loadDownloads() {
    const books = await listBooks();
    if (!alive.current) return {};
    const dls = {};
    for (const b of books) {
      if (b.kind === "chapter" && b.seriesId === item.id && b.downloaded) dls[b.chapterId] = b;
    }
    setDlByChapter(dls);
    return dls;
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [existing, dls] = await Promise.all([getBook(item.id), loadDownloads()]);
      if (!alive.current) return;
      setEntry(existing);

      // Full list so "next chapter" and counts are complete — from the module
      // cache when fresh, else paged from the server.
      let all;
      const cached = seriesCache.get(item.id);
      if (cached && Date.now() - cached.ts < SERIES_TTL) {
        all = cached.chapters;
        setChapters(all);
      } else {
        all = [];
        let offset = 0;
        for (;;) {
          const r = await getChapters(item.id, offset, CHAPTER_PAGE);
          if (!alive.current) return;
          all = all.concat(r.chapters || []);
          setChapters(all);
          setLoadNote(r.hasMore ? `Loading chapters… ${all.length}/${r.total}` : "");
          if (!r.hasMore) break;
          offset += CHAPTER_PAGE;
        }
        seriesCache.set(item.id, { chapters: all, ts: Date.now() });
      }
      setLoading(false);

      // Coming from the Continue Reading rail: jump straight back in.
      if (params.resume && existing && existing.progress && existing.progress.chapterId && !autoResumed.current) {
        const ch = all.find((c) => c.id === existing.progress.chapterId);
        if (ch) {
          autoResumed.current = true;
          read(ch, { chapterList: all, dls });
        }
      }
    } catch (e) {
      if (!alive.current) return;
      setLoading(false);
      setError(e.message || "Couldn't load chapters");
    }
  }
  useEffect(() => { load(); }, [item.id]);

  // Keep the Downloaded/Download state live while chapter downloads finish
  // in the background (the active-download set shrinking is the signal).
  useEffect(() => {
    loadDownloads().catch(() => {});
  }, [downloads.length]);

  function seriesObject() {
    return {
      id: item.id, type: "comic", provider: "mangadex", mangaId,
      title: item.title, author: item.author || null, poster: item.poster || null,
      status: item.status || null,
    };
  }

  // Open a chapter in the reader. Downloaded chapters read from disk; others
  // stream via a fresh page-URL fetch.
  async function read(ch, { chapterList = chapters, dls = dlByChapter } = {}) {
    setOpening(ch.id);
    try {
      const saver = !!getSettings().dataSaver;
      const dl = dls[ch.id];
      const pages = dl
        ? sortPages(dl.files.map((f) => f.uri).filter(Boolean))
        : (await getPages(ch.id, { saver })).pages;
      if (!alive.current) return;
      if (!pages || pages.length === 0) throw new Error("No pages for this chapter.");

      // Upsert ONLY identity fields: the shallow merge preserves the STORED
      // progress and readChapters, which the reader may have updated since
      // this screen's mount-time snapshot. Passing our stale copies here
      // would erase checkmarks/position the reader just saved.
      const saved = await upsertBook(seriesObject());
      const prog = saved.progress || {};
      const startPage = prog.chapterId === ch.id ? prog.page || 0 : 0;
      setOpening(null);
      nav.navigate("reader", {
        entry: saved,
        pages,
        startPage,
        md: {
          mangaId,
          chapter: { id: ch.id, num: ch.num, title: ch.title },
          chapters: chapterList.map((c) => ({ id: c.id, num: c.num, title: c.title })),
          saver,
        },
      });
    } catch (e) {
      if (!alive.current) return;
      setOpening(null);
      setError(e.message || "Couldn't open this chapter");
    }
  }

  // Chapter dir id: md-<mangaUuid>-<chapterUuid> = 76 chars, inside safe()'s
  // 80-char slice → unique per chapter, deletable per chapter.
  function chapterObject(ch) {
    return {
      id: `md-${mangaId}-${ch.id}`,
      kind: "chapter", type: "comic", provider: "mangadex",
      seriesId: item.id, chapterId: ch.id, chapterNum: ch.num,
      mangaId,
      title: `${item.title} — Ch. ${ch.num || "?"}`,
      poster: item.poster || null,
    };
  }

  function pagesToFiles(pages) {
    return pages.map((url, i) => {
      const ext = (String(url).match(/\.[a-z0-9]+$/i) || [".jpg"])[0];
      const n = `p${String(i + 1).padStart(3, "0")}${ext}`;
      return { title: n, url, filename: n };
    });
  }

  async function downloadChapter(ch) {
    try {
      // Make sure the series entry exists BEFORE the chapter entry does —
      // reading a downloaded chapter writes progress against the series id,
      // and those writes silently no-op if the entry was never created.
      await upsertBook(seriesObject());
      const saver = !!getSettings().dataSaver;
      const { pages } = await getPages(ch.id, { saver, fresh: true });
      if (!pages || pages.length === 0) throw new Error("No pages for this chapter.");
      startDownload(chapterObject(ch), pagesToFiles(pages));
    } catch (e) {
      if (alive.current) setError(e.message || "Couldn't start the download");
    }
  }

  // ---- bulk "download all" --------------------------------------------------
  // Strictly sequential: each chapter needs its own getPages call, and MangaDex
  // rate-limits per IP — firing a hundred at once gets the server throttled.
  // Waiting on downloadBook (not startDownload) also keeps one chapter's images
  // in flight at a time instead of hundreds.
  function confirmDownloadAll() {
    const missing = chapters.filter((c) => !dlByChapter[c.id]);
    if (missing.length === 0) return;
    Alert.alert(
      `Download ${missing.length} chapter${missing.length === 1 ? "" : "s"}?`,
      "This can be a big download and takes a while. It keeps going if you leave this screen — watch progress in your Library.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Download", onPress: () => runBulk(missing) },
      ]
    );
  }

  async function runBulk(list) {
    cancelBulk.current = false;
    setBulk({ done: 0, total: list.length, failed: 0 });
    let failed = 0;
    try {
      await upsertBook(seriesObject());
    } catch (_) {}
    const saver = !!getSettings().dataSaver;
    for (let i = 0; i < list.length; i++) {
      if (cancelBulk.current) break;
      const ch = list[i];
      try {
        const { pages } = await getPages(ch.id, { saver, fresh: true });
        if (pages && pages.length) {
          await downloadBook(chapterObject(ch), pagesToFiles(pages));
        } else {
          failed++;
        }
      } catch (_) {
        failed++; // one bad chapter shouldn't abort the whole run
      }
      // Guarded: the run intentionally outlives this screen's unmount.
      if (alive.current) setBulk({ done: i + 1, total: list.length, failed });
    }
    if (alive.current) {
      setBulk(null);
      if (failed) setError(`${failed} chapter${failed === 1 ? "" : "s"} couldn't be downloaded — tap Download all again to retry them.`);
    }
    loadDownloads().catch(() => {});
  }

  const progress = entry && entry.progress;
  const readChapters = (entry && entry.readChapters) || {};
  const continueChapter = progress && progress.chapterId
    ? chapters.find((c) => c.id === progress.chapterId)
    : null;
  const missingCount = chapters.filter((c) => !dlByChapter[c.id]).length;

  return (
    <View style={[styles.wrap, { paddingTop: topPad }]}>
      <FlatList
        data={chapters}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListHeaderComponent={
          <View>
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
                  {[item.status, item.year, chapters.length ? `${chapters.length} chapters` : null, "MangaDex"]
                    .filter(Boolean).join(" · ")}
                </Text>
              </View>
            </View>
            {item.description ? (
              <Text style={styles.desc} numberOfLines={3}>{item.description}</Text>
            ) : null}

            {continueChapter && (
              <GradientButton onPress={() => read(continueChapter)} style={{ marginBottom: 8 }}>
                <View style={styles.btnRow}>
                  <ComicIcon size={16} color="#fff" />
                  <Text style={styles.btnTxt}>
                    Continue — Ch. {continueChapter.num || "?"}, page {(progress.page || 0) + 1}
                  </Text>
                </View>
              </GradientButton>
            )}

            {!loading && chapters.length > 0 && (
              bulk ? (
                <View style={styles.bulkBox}>
                  <View style={styles.bulkRow}>
                    <ActivityIndicator color={theme.accent} size="small" />
                    <Text style={styles.bulkTxt}>
                      Downloading {bulk.done}/{bulk.total}
                      {bulk.failed ? ` · ${bulk.failed} failed` : ""}
                    </Text>
                    <TouchableOpacity onPress={() => { cancelBulk.current = true; }}>
                      <Text style={styles.bulkCancel}>Stop</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.bulkTrack}>
                    <View style={[styles.bulkFill, { width: `${Math.round((bulk.done / bulk.total) * 100)}%` }]} />
                  </View>
                </View>
              ) : missingCount > 0 ? (
                <TouchableOpacity style={styles.allBtn} onPress={confirmDownloadAll}>
                  <DownloadIcon size={15} color={theme.text} />
                  <Text style={styles.allBtnTxt}>
                    Download all ({missingCount} chapter{missingCount === 1 ? "" : "s"})
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.allDone}>
                  <CheckIcon size={13} color={theme.good} />
                  <Text style={styles.allDoneTxt}>All {chapters.length} chapters downloaded</Text>
                </View>
              )
            )}

            {error ? (
              <View style={styles.box}>
                <Text style={styles.warn}>{error}</Text>
                <TouchableOpacity style={styles.retry} onPress={load}>
                  <Text style={styles.retryTxt}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {loading && (
              <View style={styles.box}>
                <ActivityIndicator color={theme.accent} />
                <Text style={styles.dim}>{loadNote || "Loading chapters…"}</Text>
              </View>
            )}
            {!loading && !error && chapters.length === 0 && (
              <View style={styles.box}>
                <Text style={styles.boxTxt}>No readable chapters on MangaDex.</Text>
                <Text style={styles.dim}>
                  This series is probably licensed — its chapters live on the publisher's site.
                  Try the Torrents source for finished-season bundles instead.
                </Text>
              </View>
            )}
          </View>
        }
        renderItem={({ item: ch }) => {
          const isRead = !!readChapters[ch.id];
          const isCurrent = progress && progress.chapterId === ch.id;
          const dl = dlByChapter[ch.id];
          const dling = downloadingIds.has(`md-${mangaId}-${ch.id}`);
          return (
            <View style={styles.chRow}>
              <View style={styles.chMark}>
                {isRead ? <CheckIcon size={14} color={theme.good} /> : null}
              </View>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => read(ch)}>
                <Text style={[styles.chTitle, isRead && !isCurrent && { color: theme.dim }]} numberOfLines={1}>
                  Ch. {ch.num || "—"}{ch.title ? ` — ${ch.title}` : ""}
                </Text>
                <Text style={styles.chMeta} numberOfLines={1}>
                  {[ch.group, ch.publishedAt ? String(ch.publishedAt).slice(0, 10) : null, `${ch.pages} p`, dl ? "Downloaded" : null]
                    .filter(Boolean).join(" · ")}
                </Text>
              </TouchableOpacity>
              {opening === ch.id ? (
                <ActivityIndicator color={theme.accent} size="small" style={styles.chAction} />
              ) : (
                <TouchableOpacity style={styles.chAction} onPress={() => read(ch)}>
                  <Text style={styles.readTxt}>Read</Text>
                </TouchableOpacity>
              )}
              {dling ? (
                <ActivityIndicator color={theme.dim} size="small" style={styles.chAction} />
              ) : dl ? (
                <View style={styles.chAction}><CheckIcon size={13} color={theme.dim} /></View>
              ) : (
                <TouchableOpacity style={styles.chAction} onPress={() => downloadChapter(ch)}>
                  <DownloadIcon size={15} color={theme.sub} />
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 14 },
  back: { color: theme.accent, fontSize: 16 },
  head: { flexDirection: "row", gap: 14, marginBottom: 10 },
  title: { color: theme.text, fontSize: 18, fontWeight: "700" },
  author: { color: theme.sub, marginTop: 2 },
  meta: { color: theme.dim, fontSize: 12, marginTop: 6 },
  desc: { color: theme.sub, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  box: { backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 18, alignItems: "center", gap: 8, marginTop: 6, marginBottom: 10 },
  boxTxt: { color: theme.text, textAlign: "center" },
  dim: { color: theme.dim, fontSize: 13, textAlign: "center" },
  warn: { color: theme.warn, textAlign: "center" },
  allBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9,
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
    borderRadius: 12, paddingVertical: 13, marginBottom: 10,
  },
  allBtnTxt: { color: theme.text, fontWeight: "700", fontSize: 15 },
  allDone: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 10, marginBottom: 6 },
  allDoneTxt: { color: theme.dim, fontSize: 13, fontWeight: "600" },
  bulkBox: {
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
    borderRadius: 12, padding: 12, marginBottom: 10, gap: 9,
  },
  bulkRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bulkTxt: { color: theme.text, fontWeight: "600", flex: 1 },
  bulkCancel: { color: theme.warn, fontWeight: "700", paddingHorizontal: 4 },
  bulkTrack: { height: 4, backgroundColor: theme.border, borderRadius: 2 },
  bulkFill: { height: 4, backgroundColor: theme.accent, borderRadius: 2 },
  retry: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 8, backgroundColor: theme.accent, borderRadius: 8 },
  retryTxt: { color: "#fff", fontWeight: "600" },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  btnTxt: { color: "#fff", fontWeight: "700", fontSize: 15 },
  chRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border,
  },
  chMark: { width: 18, alignItems: "center" },
  chTitle: { color: theme.text, fontWeight: "600", fontSize: 14 },
  chMeta: { color: theme.dim, fontSize: 11, marginTop: 2 },
  chAction: { paddingHorizontal: 8, paddingVertical: 6, minWidth: 40, alignItems: "center" },
  readTxt: { color: theme.accent, fontWeight: "700", fontSize: 13 },
});
