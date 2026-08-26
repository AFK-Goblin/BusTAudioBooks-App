import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList, ScrollView,
  StyleSheet, ActivityIndicator, Keyboard,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { theme } from "../src/theme";
import { search, health } from "../src/api";
import { formatBytes } from "../src/format";
import { continueListening, continueReading } from "../src/library";
import { loadBook } from "../src/player";
import { useDownloads } from "../src/downloadStore";
import { CoverArt } from "../src/ui";
import { SearchIcon, CloseIcon, NoteGlyph } from "../src/icons";
import { useScreenPad } from "../src/layout";

// One screen, two content types: the Home tab renders it as audiobooks, the
// Comics tab as comics. Everything type-specific lives in this table; the
// Comics tab additionally splits into two sources ("Series" = MangaDex for
// ongoing manga/webtoons, "Torrents" = the Jackett/TorBox archive path).
const CONTENT = {
  audiobook: {
    brand: "BusTAudioBooks",
    placeholder: "Search audiobooks…",
    recentsKey: "bustaudio_recent",
    contSection: "Continue Listening",
    detailScreen: "book",
    categories: [
      "Fantasy", "Sci-Fi", "Mystery", "Thriller", "Romance",
      "LitRPG", "Biography", "History", "Self-Help", "Horror",
    ],
  },
  comic: {
    brand: "Comics",
    contSection: "Continue Reading",
    detailScreen: "comic",
    sources: {
      // MangaDex matches TITLES (not genres), so the browse chips are
      // popular-series seeds rather than genre words.
      series: {
        placeholder: "Search manga & webtoons…",
        recentsKey: "bustaudio_recent_manga",
        categories: [
          "Omniscient Reader", "One Piece", "Berserk", "Chainsaw Man",
          "Eleceed", "Tower of God", "Kagurabachi", "Dandadan",
        ],
      },
      torrents: {
        placeholder: "Search comics…",
        recentsKey: "bustaudio_recent_comics",
        categories: [
          "Manhwa", "Manga", "Superhero", "Action", "Fantasy",
          "Romance", "Isekai", "Horror",
        ],
      },
    },
  },
};

// Survives unmount: only the top screen is mounted, so without this the
// search results vanish every time you open a book and come back.
const emptyCache = () => ({ q: "", items: [], searched: false, page: 1, noMore: false });
const caches = { audiobook: emptyCache(), "comic:series": emptyCache(), "comic:torrents": emptyCache() };

// The chosen comics source also survives unmount (tab switches remount us).
let comicSourcePersist = "series";

const RECENT_MAX = 8;

export default function SearchScreen({ nav, contentType = "audiobook" }) {
  const [comicSource, setComicSourceState] = useState(comicSourcePersist);
  const base = CONTENT[contentType] || CONTENT.audiobook;
  const C = base.sources ? { ...base, ...base.sources[comicSource] } : base;
  const CATEGORIES = C.categories;
  const RKEY = C.recentsKey;
  const bucket = contentType === "comic" ? `comic:${comicSource}` : "audiobook";
  const cache = caches[bucket];
  const setCache = (next) => { caches[bucket] = next; };
  // Which bucket is on screen right now — in-flight searches check this so a
  // response for the OLD source never repaints under the new source's chip.
  const bucketRef = useRef(bucket);
  bucketRef.current = bucket;
  const [q, setQ] = useState(cache.q);
  const [items, setItems] = useState(cache.items);
  const [busy, setBusy] = useState(false);
  const [busyMore, setBusyMore] = useState(false);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState(cache.searched);
  const [noMore, setNoMore] = useState(cache.noMore);
  const [cont, setCont] = useState([]);
  const [recents, setRecents] = useState([]);
  const [serverNote, setServerNote] = useState(null);
  const downloads = useDownloads();
  const topPad = useScreenPad();

  // Switching Series ⇄ Torrents swaps cache buckets in place (no refetch, no
  // remount) — every piece of search state must be resynced from the bucket.
  function setComicSource(source) {
    if (source === comicSource) return;
    comicSourcePersist = source;
    setComicSourceState(source);
    const c = caches[`comic:${source}`];
    setQ(c.q); setItems(c.items); setSearched(c.searched); setNoMore(c.noMore);
    setError(null); setServerNote(null);
    setBusy(false); setBusyMore(false); // any in-flight search belongs to the old bucket
  }

  // Each comics source has its own server prerequisite — say so up front
  // instead of letting every search come back empty.
  useEffect(() => {
    if (contentType !== "comic") return;
    setServerNote(null);
    (async () => {
      try {
        const h = await health();
        const s = h && h.sources;
        if (comicSource === "series") {
          if (!s || s.mangadex === undefined) {
            setServerNote("Your server doesn't support the Series source yet — update the BusTAudio server (v2.1+).");
          } else if (!s.mangadex) {
            setServerNote("The Series source is disabled on this server (MANGADEX_DISABLED).");
          }
        } else if (!s || s.comics === undefined) {
          setServerNote("Your server doesn't support comics yet — update the BusTAudio server to enable this tab.");
        } else if (!s.comics) {
          setServerNote("Torrent comics need Jackett/Prowlarr configured on your server (an indexer with comics, category 7030).");
        }
      } catch (_) {
        /* offline — the search itself will surface the error */
      }
    })();
  }, [contentType, comicSource]);

  useEffect(() => {
    (async () => {
      setCont(contentType === "comic" ? await continueReading() : await continueListening());
      try {
        const r = await AsyncStorage.getItem(RKEY);
        setRecents(r ? JSON.parse(r) : []);
      } catch (_) {}
    })();
  }, [RKEY]);

  async function rememberSearch(query) {
    // Category chips aren't "searches" worth remembering.
    if (CATEGORIES.includes(query)) return;
    const next = [query, ...recents.filter((r) => r.toLowerCase() !== query.toLowerCase())].slice(0, RECENT_MAX);
    setRecents(next);
    AsyncStorage.setItem(RKEY, JSON.stringify(next)).catch(() => {});
  }

  function clearRecents() {
    setRecents([]);
    AsyncStorage.removeItem(RKEY).catch(() => {});
  }

  const run = useCallback(async (term) => {
    const query = (term != null ? term : q).trim();
    if (!query) return;
    if (term != null) setQ(term);
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    setSearched(true);
    const myBucket = bucket;
    try {
      const results = await search(query, 1, contentType, comicSource);
      // Always record into the bucket this search belongs to…
      caches[myBucket] = { q: query, items: results, searched: true, page: 1, noMore: results.length === 0 };
      // …but only repaint if the user hasn't switched source meanwhile.
      if (bucketRef.current !== myBucket) return;
      setItems(results);
      setNoMore(results.length === 0);
      if (results.length > 0) rememberSearch(query);
    } catch (e) {
      if (bucketRef.current !== myBucket) return;
      setError(e.message || "Search failed");
      setItems([]);
    } finally {
      if (bucketRef.current === myBucket) setBusy(false);
    }
  }, [q, comicSource, bucket]);

  async function loadMore() {
    const myBucket = bucket;
    const cur = caches[myBucket];
    if (busyMore || noMore || !cur.q) return;
    setBusyMore(true);
    try {
      const next = cur.page + 1;
      const more = await search(cur.q, next, contentType, comicSource);
      const seen = new Set(cur.items.map((it) => it.id));
      const fresh = more.filter((it) => !seen.has(it.id));
      const merged = [...cur.items, ...fresh];
      caches[myBucket] = { ...cur, items: merged, page: next, noMore: fresh.length === 0 };
      if (bucketRef.current !== myBucket) return;
      setItems(merged);
      setNoMore(fresh.length === 0);
    } catch (_) {
      /* keep what we have; the button stays for another try */
    } finally {
      setBusyMore(false);
    }
  }

  async function resume(book) {
    if (contentType === "comic") {
      // Series entries resume via SeriesScreen (chapter-aware); torrent comics
      // via ComicScreen (local pages, cached pages, or re-resolve).
      const screen = book.provider === "mangadex" ? "series" : "comic";
      nav.navigate(screen, { item: book, resume: true });
      return;
    }
    const p = book.progress || {};
    try {
      await loadBook(book, p.trackIndex || 0, p.position || 0);
      nav.navigate("player");
    } catch (_) {
      nav.navigate("book", { item: book });
    }
  }

  function clearSearch() {
    setQ(""); setItems([]); setSearched(false); setError(null); setNoMore(false);
    setCache(emptyCache());
  }

  const showHome = !searched && items.length === 0;

  return (
    <View style={[styles.wrap, { paddingTop: topPad }]}>
      <Text style={styles.brand}>{C.brand}</Text>

      {contentType === "comic" && (
        <View style={styles.sourceRow}>
          {[["series", "Series"], ["torrents", "Torrents"]].map(([key, label]) => {
            const active = comicSource === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.sourceChip, active && styles.sourceChipActive]}
                onPress={() => setComicSource(key)}
              >
                <Text style={[styles.sourceChipTxt, active && styles.sourceChipTxtActive]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
          <Text style={styles.sourceHint}>
            {comicSource === "series" ? "Ongoing · MangaDex" : "Archives · via TorBox"}
          </Text>
        </View>
      )}

      <View style={styles.searchRow}>
        <View style={styles.inputWrap}>
          <SearchIcon size={18} color={theme.dim} />
          <TextInput
            style={styles.input}
            placeholder={C.placeholder}
            placeholderTextColor={theme.dim}
            value={q}
            onChangeText={setQ}
            onSubmitEditing={() => run()}
            returnKeyType="search"
            autoCorrect={false}
          />
        </View>
        {searched ? (
          <TouchableOpacity style={styles.searchBtn} onPress={clearSearch}>
            <CloseIcon size={14} color="#fff" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.searchBtn} onPress={() => run()}>
            <Text style={styles.searchBtnTxt}>Go</Text>
          </TouchableOpacity>
        )}
      </View>

      {serverNote && (
        <View style={styles.notePill}>
          <Text style={styles.noteTxt}>⚠️ {serverNote}</Text>
        </View>
      )}

      {downloads.length > 0 && (
        <TouchableOpacity style={styles.dlPill} onPress={() => nav.reset("library")}>
          <ActivityIndicator color={theme.accent} size="small" />
          <Text style={styles.dlPillTxt}>
            Downloading {downloads.length} book{downloads.length > 1 ? "s" : ""} — tap to view
          </Text>
        </TouchableOpacity>
      )}

      {busy ? (
        <ActivityIndicator color={theme.accent} style={{ marginTop: 40 }} />
      ) : error ? (
        <View style={styles.emptyBox}>
          <Text style={styles.err}>{error}</Text>
          <TouchableOpacity style={styles.retry} onPress={() => run()}>
            <Text style={styles.retryTxt}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : showHome ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 90 }} keyboardShouldPersistTaps="handled">
          {cont.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.section}>{C.contSection}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
                {cont.map((b) => {
                  const pr = b.progress || {};
                  const pct =
                    contentType === "comic"
                      ? pr.totalPages ? Math.min(100, Math.round(((pr.page + 1) / pr.totalPages) * 100)) : 0
                      : pr.duration ? Math.min(100, Math.round((pr.position / pr.duration) * 100)) : 0;
                  return (
                    <TouchableOpacity key={b.id} style={styles.contCard} onPress={() => resume(b)}>
                      <CoverArt uri={b.poster} size={120} radius={8} />
                      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
                      <Text style={styles.contTitle} numberOfLines={2}>{b.title}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {recents.length > 0 && (
            <View>
              <View style={styles.sectionRow}>
                <Text style={styles.section}>Recent</Text>
                <TouchableOpacity onPress={clearRecents}>
                  <Text style={styles.sectionAction}>Clear</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.chips}>
                {recents.map((r) => (
                  <TouchableOpacity key={r} style={styles.chip} onPress={() => run(r)}>
                    <Text style={styles.chipTxt}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <Text style={styles.section}>Browse</Text>
          <View style={styles.chips}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity key={c} style={styles.chip} onPress={() => run(c)}>
                <Text style={styles.chipTxt}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {cont.length === 0 && (
            <View style={styles.emptyBox}>
              <NoteGlyph size={38} color={theme.border} />
              <Text style={styles.hello}>Search for a title or author above, or tap a category to explore.</Text>
            </View>
          )}
        </ScrollView>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ paddingBottom: 90 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <NoteGlyph size={38} color={theme.border} />
              <Text style={styles.hello}>No results for “{cache.q}”. Try another spelling or a shorter query.</Text>
            </View>
          }
          ListFooterComponent={
            items.length > 0 && !noMore ? (
              <TouchableOpacity style={styles.more} onPress={loadMore} disabled={busyMore}>
                {busyMore
                  ? <ActivityIndicator color={theme.accent} size="small" />
                  : <Text style={styles.moreTxt}>Load more</Text>}
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() =>
                nav.navigate(item.provider === "mangadex" ? "series" : C.detailScreen, { item })
              }
            >
              <CoverArt uri={item.poster} size={56} radius={6} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                {item.author ? <Text style={styles.author} numberOfLines={1}>{item.author}</Text> : null}
                <Text style={styles.meta} numberOfLines={1}>
                  {item.provider === "mangadex"
                    ? [item.status, item.year, "MangaDex"].filter(Boolean).join(" · ")
                    : [item.cached ? "⚡ Instant" : null, item.format, item.bitrate, item.sizeText || formatBytes(item.size)].filter(Boolean).join(" · ")}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
  brand: { color: theme.text, fontSize: 22, fontWeight: "800", marginBottom: 14 },
  searchRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  inputWrap: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
    borderRadius: 10, paddingHorizontal: 12, height: 44,
  },
  input: { flex: 1, color: theme.text, height: 44 },
  searchBtn: { backgroundColor: theme.accent, borderRadius: 10, paddingHorizontal: 18, justifyContent: "center", minWidth: 46, alignItems: "center" },
  searchBtnTxt: { color: "#fff", fontWeight: "700" },
  dlPill: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 10, marginBottom: 12 },
  notePill: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 10, marginBottom: 12 },
  noteTxt: { color: theme.sub, fontSize: 13, lineHeight: 18 },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  sourceChip: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 8 },
  sourceChipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  sourceChipTxt: { color: theme.sub, fontWeight: "700", fontSize: 13 },
  sourceChipTxtActive: { color: "#fff" },
  sourceHint: { color: theme.dim, fontSize: 11, marginLeft: "auto" },
  dlPillTxt: { color: theme.text, fontSize: 13, flex: 1 },
  section: { color: theme.sub, fontWeight: "700", fontSize: 13, textTransform: "uppercase", marginTop: 16, marginBottom: 8 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  sectionAction: { color: theme.accent, fontSize: 12, fontWeight: "600" },
  contCard: { width: 120 },
  progressTrack: { height: 3, backgroundColor: theme.border, borderRadius: 2, marginTop: 6 },
  progressFill: { height: 3, backgroundColor: theme.accent, borderRadius: 2 },
  contTitle: { color: theme.text, fontSize: 12, marginTop: 5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  chipTxt: { color: theme.text, fontWeight: "600" },
  emptyBox: { alignItems: "center", marginTop: 36, gap: 10, paddingHorizontal: 20 },
  hello: { color: theme.dim, textAlign: "center", lineHeight: 20 },
  row: { flexDirection: "row", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  title: { color: theme.text, fontWeight: "600" },
  author: { color: theme.sub, fontSize: 13, marginTop: 1 },
  meta: { color: theme.dim, fontSize: 12, marginTop: 3 },
  err: { color: "#f87171", textAlign: "center" },
  retry: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  retryTxt: { color: theme.text, fontWeight: "600" },
  more: { alignItems: "center", paddingVertical: 16 },
  moreTxt: { color: theme.accent, fontWeight: "700" },
});
