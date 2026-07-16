import React, { useState, useEffect, useCallback } from "react";
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
// Comics tab as comics. Everything type-specific lives in this table.
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
    placeholder: "Search comics…",
    recentsKey: "bustaudio_recent_comics",
    contSection: "Continue Reading",
    detailScreen: "comic",
    categories: [
      "Manhwa", "Manga", "Superhero", "Action", "Fantasy",
      "Romance", "Isekai", "Horror",
    ],
  },
};

// Survives unmount: only the top screen is mounted, so without this the
// search results vanish every time you open a book and come back.
const emptyCache = () => ({ q: "", items: [], searched: false, page: 1, noMore: false });
const caches = { audiobook: emptyCache(), comic: emptyCache() };

const RECENT_MAX = 8;

export default function SearchScreen({ nav, contentType = "audiobook" }) {
  const C = CONTENT[contentType] || CONTENT.audiobook;
  const CATEGORIES = C.categories;
  const RKEY = C.recentsKey;
  const cache = caches[contentType];
  const setCache = (next) => { caches[contentType] = next; };
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

  // The Comics tab only works when the server supports it AND has Jackett —
  // say so up front instead of letting every search come back empty.
  useEffect(() => {
    if (contentType !== "comic") return;
    (async () => {
      try {
        const h = await health();
        const s = h && h.sources;
        if (!s || s.comics === undefined) {
          setServerNote("Your server doesn't support comics yet — update the BusTAudio server to enable this tab.");
        } else if (!s.comics) {
          setServerNote("Comics search needs Jackett/Prowlarr configured on your server (an indexer with comics, category 7030).");
        }
      } catch (_) {
        /* offline — the search itself will surface the error */
      }
    })();
  }, [contentType]);

  useEffect(() => {
    (async () => {
      setCont(contentType === "comic" ? await continueReading() : await continueListening());
      try {
        const r = await AsyncStorage.getItem(RKEY);
        if (r) setRecents(JSON.parse(r));
      } catch (_) {}
    })();
  }, []);

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
    try {
      const results = await search(query, 1, contentType);
      setItems(results);
      setNoMore(results.length === 0);
      setCache({ q: query, items: results, searched: true, page: 1, noMore: results.length === 0 });
      if (results.length > 0) rememberSearch(query);
    } catch (e) {
      setError(e.message || "Search failed");
      setItems([]);
    } finally {
      setBusy(false);
    }
  }, [q]);

  async function loadMore() {
    const cur = caches[contentType];
    if (busyMore || noMore || !cur.q) return;
    setBusyMore(true);
    try {
      const next = cur.page + 1;
      const more = await search(cur.q, next, contentType);
      const seen = new Set(cur.items.map((it) => it.id));
      const fresh = more.filter((it) => !seen.has(it.id));
      const merged = [...cur.items, ...fresh];
      setCache({ ...cur, items: merged, page: next, noMore: fresh.length === 0 });
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
      // ComicScreen owns re-opening (local pages, cached pages, or re-resolve).
      nav.navigate("comic", { item: book, resume: true });
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
            <TouchableOpacity style={styles.row} onPress={() => nav.navigate(C.detailScreen, { item })}>
              <CoverArt uri={item.poster} size={56} radius={6} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                {item.author ? <Text style={styles.author} numberOfLines={1}>{item.author}</Text> : null}
                <Text style={styles.meta} numberOfLines={1}>
                  {[item.cached ? "⚡ Instant" : null, item.format, item.bitrate, item.sizeText || formatBytes(item.size)].filter(Boolean).join(" · ")}
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
