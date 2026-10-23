import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList, ScrollView,
  StyleSheet, ActivityIndicator, Keyboard,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { theme } from "../src/theme";
import { search } from "../src/api";
import { formatBytes, formatDuration } from "../src/format";
import { audiobookEstimate } from "../src/playback/progressModel";
import { continueListening, getLibrary, wantToListen } from "../src/library";
import { continueSeries, seriesNews, becauseYouListened, comingLabel } from "../src/series";
import { showToast } from "../src/toast";
import { resumeOrLoad, pause, usePlaybackSnapshot } from "../src/player";
import { useDownloads } from "../src/downloadStore";
import { CoverArt, CoverBackdrop, PlayPauseIcon, SkeletonRows } from "../src/ui";
import { LinearGradient } from "expo-linear-gradient";
import { SearchIcon, CloseIcon, NoteGlyph, ChevronIcon } from "../src/icons";
import { useScreenPad } from "../src/layout";
import { useSettings, setSetting } from "../src/settings";
import { useListeningStats } from "../src/stats";

const RECENTS_KEY = "bustaudio_recent";
const CATEGORIES = [
  "Fantasy", "Sci-Fi", "Mystery", "Thriller", "Romance",
  "LitRPG", "Biography", "History", "Self-Help", "Horror",
];

// Survives unmount: only the top screen is mounted, so without this the
// search results vanish every time you open a book and come back.
const emptyCache = () => ({ q: "", items: [], searched: false, page: 1, noMore: false });
let cache = emptyCache();

const RECENT_MAX = 8;

export default function SearchScreen({ nav, params = {} }) {
  const [q, setQ] = useState(cache.q);
  const [items, setItems] = useState(cache.items);
  const [busy, setBusy] = useState(false);
  const [busyMore, setBusyMore] = useState(false);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState(cache.searched);
  const [noMore, setNoMore] = useState(cache.noMore);
  const [cont, setCont] = useState([]);
  const [owned, setOwned] = useState({}); // library entries by id, for result badges
  const [recents, setRecents] = useState([]);
  const [seriesNext, setSeriesNext] = useState([]); // [{ series, book, owned }] for "Continue the series"
  const [news, setNews] = useState([]); // [{ series, book }] for "New in your series"
  const [because, setBecause] = useState(null); // { because, books } for "Because you listened to…"
  const downloads = useDownloads();
  const topPad = useScreenPad();
  const snapshot = usePlaybackSnapshot();
  const settings = useSettings();
  const stats = useListeningStats();
  // Cached torrents play at once; the rest wait for TorBox to fetch them.
  const instantOnly = !!settings.instantOnly;
  const instantCount = items.filter((it) => it.cached).length;
  const offerInstant = instantCount > 0 && instantCount < items.length;
  // Results in several formats (M4B, MP3…) can be narrowed to one; M4B
  // usually means one file with chapters.
  const [formatPick, setFormatPick] = useState(null);
  const formats = [...new Set(items.map(formatOf).filter(Boolean))];
  const pickedFormat = formats.length > 1 && formats.includes(formatPick) ? formatPick : null;
  const afterInstant = instantOnly && instantCount > 0 ? items.filter((it) => it.cached) : items;
  const shown = pickedFormat ? afterInstant.filter((it) => formatOf(it) === pickedFormat) : afterInstant;
  // Uploads of the same book (same title and author) share one row.
  const groups = groupUploads(shown);
  const [expanded, setExpanded] = useState([]); // group keys showing their other uploads

  useEffect(() => {
    let alive = true;
    (async () => {
      setCont(await continueListening());
      const lib = await getLibrary().catch(() => ({}));
      setOwned(lib);
      try {
        const r = await AsyncStorage.getItem(RECENTS_KEY);
        setRecents(r ? JSON.parse(r) : []);
      } catch (_) {}
      // Last: it may ask the server about a few series.
      const books = Object.values(lib).filter((b) => b && b.type !== "comic");
      const next = await continueSeries(books).catch(() => []);
      if (alive) setSeriesNext(next);
      // What's new in those series (minus what "Continue the series" shows)…
      const shown = new Set(next.map((n) => n.book.title));
      const fresh = await seriesNews(books).catch(() => []);
      if (alive) setNews(fresh.filter((n) => !shown.has(n.book.title)));
      // …and something different.
      const similar = await becauseYouListened(books).catch(() => null);
      if (alive) setBecause(similar);
    })();
    return () => { alive = false; };
  }, []);

  async function rememberSearch(query) {
    // Category chips aren't "searches" worth remembering.
    if (CATEGORIES.includes(query)) return;
    const next = [query, ...recents.filter((r) => r.toLowerCase() !== query.toLowerCase())].slice(0, RECENT_MAX);
    setRecents(next);
    AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next)).catch(() => {});
  }

  function clearRecents() {
    setRecents([]);
    AsyncStorage.removeItem(RECENTS_KEY).catch(() => {});
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
      const results = await search(query, 1);
      cache = { q: query, items: results, searched: true, page: 1, noMore: results.length === 0 };
      setItems(results);
      setNoMore(results.length === 0);
      if (results.length > 0) rememberSearch(query);
    } catch (e) {
      setError(e.message || "Search failed");
      setItems([]);
    } finally {
      setBusy(false);
    }
  // rememberSearch only reads recents, which can't change mid-search.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function loadMore() {
    const cur = cache;
    if (busyMore || noMore || !cur.q) return;
    setBusyMore(true);
    try {
      const next = cur.page + 1;
      const more = await search(cur.q, next);
      const seen = new Set(cur.items.map((it) => it.id));
      const fresh = more.filter((it) => !seen.has(it.id));
      const merged = [...cur.items, ...fresh];
      cache = { ...cur, items: merged, page: next, noMore: fresh.length === 0 };
      setItems(merged);
      setNoMore(fresh.length === 0);
    } catch (_) {
      /* keep what we have; the button stays for another try */
    } finally {
      setBusyMore(false);
    }
  }

  async function resume(book) {
    try {
      await resumeOrLoad(book);
      nav.navigate("player");
    } catch (_) {
      nav.navigate("book", { item: book });
    }
  }

  function clearSearch() {
    setQ(""); setItems([]); setSearched(false); setError(null); setNoMore(false);
    cache = emptyCache();
  }

  // Opened from a book page's author link: search for that author.
  useEffect(() => {
    // Navigation hands us the query; starting that search is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (params.query) run(params.query);
    // Only when a new author arrives — run changes with every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.query]);

  const showHome = !searched && items.length === 0;
  const goal = settings.dailyGoal || 0;
  const todayLine = !stats ? null : [
    goal ? `${formatDuration(stats.today)} of ${goal}m today${stats.today >= goal * 60 ? " ✓" : ""}` : stats.today >= 60 ? `${formatDuration(stats.today)} listened today` : null,
    stats.streak >= 2 ? `${stats.streak}-day streak` : null,
  ].filter(Boolean).join(" · ") || null;
  const saved = wantToListen(Object.values(owned));

  return (
    <View style={[styles.wrap, { paddingTop: topPad }]}>
      {nav.depth > 1 ? (
        <TouchableOpacity onPress={nav.goBack} style={styles.backRow}>
          <ChevronIcon dir="left" size={18} color={theme.accent} />
          <Text style={styles.back}>Back</Text>
        </TouchableOpacity>
      ) : null}
      {nav.depth > 1 ? (
        <Text style={styles.brand}>BusTAudioBooks</Text>
      ) : (
        <View style={styles.greetingBox}>
          <Text style={[styles.brand, { marginBottom: 0 }]}>{greeting(new Date().getHours())}</Text>
          {todayLine ? (
            <TouchableOpacity onPress={() => nav.navigate("stats")} accessibilityRole="button" accessibilityHint="Opens your listening stats">
              <Text style={styles.today}>{todayLine} <Text style={styles.todayMore}>›</Text></Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      <View style={styles.searchRow}>
        <View style={styles.inputWrap}>
          <SearchIcon size={18} color={theme.dim} />
          <TextInput
            style={styles.input}
            placeholder="Search audiobooks…"
            placeholderTextColor={theme.dim}
            value={q}
            onChangeText={setQ}
            onSubmitEditing={() => run()}
            returnKeyType="search"
            autoCorrect={false}
          />
        </View>
        {searched ? (
          <TouchableOpacity style={styles.searchBtn} onPress={clearSearch} accessibilityLabel="Clear search">
            <CloseIcon size={14} color="#fff" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.searchBtn} onPress={() => run()} accessibilityLabel="Search">
            <Text style={styles.searchBtnTxt}>Go</Text>
          </TouchableOpacity>
        )}
      </View>

      {downloads.length > 0 && (
        <TouchableOpacity style={styles.dlPill} onPress={() => nav.reset("library")}>
          <ActivityIndicator color={theme.accent} size="small" />
          <Text style={styles.dlPillTxt}>
            Downloading {downloads.length} book{downloads.length > 1 ? "s" : ""} — tap to view
          </Text>
        </TouchableOpacity>
      )}

      {busy ? (
        <SkeletonRows />
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
            <HeroCard
              book={cont[0]}
              playing={!!(snapshot.book && snapshot.book.id === cont[0].id && snapshot.intent === "playing")}
              onOpen={() => resume(cont[0])}
              onPlayPause={(playing) => (playing ? pause().catch(() => {}) : resumeOrLoad(cont[0]).catch(() => resume(cont[0])))}
            />
          )}

          {cont.length > 1 && (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.section}>Also listening to</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
                {cont.slice(1).map((b) => {
                  const estimate = audiobookEstimate(b);
                  const pct = Math.round(estimate.percentage);
                  return (
                    <TouchableOpacity key={b.id} style={styles.contCard} onPress={() => resume(b)}>
                      <CoverArt uri={b.poster} size={120} radius={8} />
                      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
                      <Text style={styles.contTitle} numberOfLines={2}>{b.title}</Text>
                      {estimate.remainingSeconds != null ? (
                        <Text style={styles.contMeta} numberOfLines={1}>
                          {estimate.estimated ? "~" : ""}{formatDuration(estimate.remainingSeconds)} left
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {seriesNext.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.section}>Continue the series</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
                {seriesNext.map(({ series, book, owned: copy }) => (
                  <TouchableOpacity
                    key={series}
                    style={styles.savedCard}
                    onPress={() => (copy ? nav.navigate("book", { item: copy }) : run(book.search || book.title))}
                    accessibilityLabel={`Next in ${series}: book ${book.position}, ${book.title}${copy ? ", in your library" : ""}`}
                  >
                    <CoverArt uri={book.poster} size={96} radius={8} />
                    <Text style={styles.contTitle} numberOfLines={2}>{book.title}</Text>
                    <Text style={styles.contMeta} numberOfLines={1}>{copy ? "In your library" : `${series} #${book.position}`}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {news.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.section}>New in your series</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
                {news.map(({ series, book }) => (
                  <TouchableOpacity
                    key={`${series}:${book.position}`}
                    style={styles.savedCard}
                    activeOpacity={book.upcoming ? 1 : 0.7}
                    onPress={() => (book.upcoming
                      ? showToast(`“${book.title}” isn't out yet — ${comingLabel(book.released).replace("Coming", "it's due")}.`)
                      : run(book.search || book.title))}
                    accessibilityLabel={`${series} book ${book.position}: ${book.title}, ${book.upcoming ? comingLabel(book.released) : "just released"}`}
                  >
                    <View style={book.upcoming && { opacity: 0.6 }}><CoverArt uri={book.poster} size={96} radius={8} /></View>
                    <Text style={styles.contTitle} numberOfLines={2}>{book.title}</Text>
                    <Text style={[styles.contMeta, !book.upcoming && { color: theme.good }]} numberOfLines={1}>
                      {book.upcoming ? comingLabel(book.released) : `New · ${series} #${book.position}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {because && (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.section} numberOfLines={1}>Because you listened to {because.because}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
                {because.books.map((book) => (
                  <TouchableOpacity
                    key={book.asin || book.title}
                    style={styles.savedCard}
                    onPress={() => run(book.search || book.title)}
                    accessibilityLabel={`${book.title}${book.author ? ` by ${book.author}` : ""}. Search for it`}
                  >
                    <CoverArt uri={book.poster} size={96} radius={8} />
                    <Text style={styles.contTitle} numberOfLines={2}>{book.title}</Text>
                    <Text style={styles.contMeta} numberOfLines={1}>
                      {book.kind === "author" ? `More by ${(book.author || "").split(",")[0]}` : book.author || (book.series ? book.series.name : "")}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {saved.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.section}>Want to listen</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
                {saved.map((b) => (
                  <TouchableOpacity key={b.id} style={styles.savedCard} onPress={() => nav.navigate("book", { item: b })} accessibilityLabel={`${b.title}, saved for later`}>
                    <CoverArt uri={b.poster} size={96} radius={8} />
                    <Text style={styles.contTitle} numberOfLines={2}>{b.title}</Text>
                  </TouchableOpacity>
                ))}
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
          data={groups}
          keyExtractor={(group) => group.key}
          contentContainerStyle={{ paddingBottom: 90 }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            offerInstant || instantOnly || formats.length > 1 ? (
              <View style={styles.filterRow}>
                {offerInstant || instantOnly ? (
                  <TouchableOpacity
                    style={[styles.filterChip, instantOnly && styles.filterChipActive]}
                    onPress={() => setSetting("instantOnly", !instantOnly)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: instantOnly }}
                  >
                    <Text style={[styles.filterChipTxt, instantOnly && styles.filterChipTxtActive]}>
                      ⚡ Instant only{instantOnly ? ` · ${instantCount} of ${items.length}` : ` (${instantCount})`}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {formats.length > 1 ? formats.map((format) => (
                  <TouchableOpacity
                    key={format}
                    style={[styles.filterChip, pickedFormat === format && styles.filterChipActive]}
                    onPress={() => setFormatPick(pickedFormat === format ? null : format)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: pickedFormat === format }}
                    accessibilityLabel={`Only ${format}`}
                  >
                    <Text style={[styles.filterChipTxt, pickedFormat === format && styles.filterChipTxtActive]}>{format}</Text>
                  </TouchableOpacity>
                )) : null}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <NoteGlyph size={38} color={theme.border} />
              <Text style={styles.hello}>
                {items.length > 0 ? "Nothing here matches these filters." : `No results for “${cache.q}”. Try another spelling or a shorter query.`}
              </Text>
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
          renderItem={({ item: group }) => {
            const open = expanded.includes(group.key);
            const row = (item, other) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.row, other && styles.otherRow]}
                onPress={() => nav.navigate("book", { item })}
              >
                <CoverArt uri={item.poster} size={other ? 40 : 56} radius={6} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                  {item.author && !other ? <Text style={styles.author} numberOfLines={1}>{item.author}</Text> : null}
                  {libraryBadge(owned[item.id]) ? (
                    <Text style={styles.badge} numberOfLines={1}>{libraryBadge(owned[item.id])}</Text>
                  ) : null}
                  <View style={styles.metaRow}>
                    {item.cached ? <Text style={styles.instantTag}>⚡ Instant</Text> : null}
                    <Text style={[styles.meta, { flexShrink: 1 }]} numberOfLines={1}>
                      {[item.format, item.bitrate, item.sizeText || formatBytes(item.size)].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
            return (
              <View>
                {row(group.best, false)}
                {group.others.length > 0 ? (
                  <TouchableOpacity
                    style={styles.moreUploads}
                    onPress={() => setExpanded((keys) => (open ? keys.filter((k) => k !== group.key) : [...keys, group.key]))}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                  >
                    <Text style={styles.moreUploadsTxt}>
                      {open ? "Hide other uploads" : `+${group.others.length} more upload${group.others.length === 1 ? "" : "s"}`}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {open ? group.others.map((other) => row(other, true)) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

// The book you were last listening to, front and centre: one tap on the
// button resumes it right here; tapping the card opens the player.
function HeroCard({ book, playing, onOpen, onPlayPause }) {
  const estimate = audiobookEstimate(book);
  const pct = Math.round(estimate.percentage);
  const parts = (book.files || []).length;
  const prog = book.progress || {};
  const meta = [
    `${pct}%`,
    estimate.remainingSeconds != null ? `${estimate.estimated ? "~" : ""}${formatDuration(estimate.remainingSeconds)} left` : null,
    parts > 1 ? `part ${(prog.trackIndex || 0) + 1} of ${parts}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <TouchableOpacity style={styles.hero} activeOpacity={0.9} onPress={onOpen} accessibilityLabel={`Continue ${book.title}`}>
      <CoverBackdrop uri={book.poster} />
      <Text style={styles.heroKicker}>{playing ? "NOW PLAYING" : "CONTINUE LISTENING"}</Text>
      <View style={styles.heroRow}>
        <CoverArt uri={book.poster} size={92} radius={10} />
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle} numberOfLines={2}>{book.title}</Text>
          {book.author ? <Text style={styles.heroAuthor} numberOfLines={1}>{book.author}</Text> : null}
          <Text style={styles.heroMeta} numberOfLines={1}>{meta}</Text>
        </View>
        <TouchableOpacity onPress={() => onPlayPause(playing)} accessibilityLabel={playing ? "Pause" : `Resume ${book.title}`} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <LinearGradient colors={theme.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroPlay}>
            <PlayPauseIcon playing={playing} size={20} />
          </LinearGradient>
        </TouchableOpacity>
      </View>
      <View style={styles.heroTrack}><View style={[styles.heroFill, { width: `${pct}%` }]} /></View>
    </TouchableOpacity>
  );
}

function bookKey(item) {
  const plain = (text) => String(text || "").toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return `${plain(item.title)}|${plain(item.author)}`;
}

// Several uploads of one book under one row, in the server's order, led by a
// cached (instant) upload when there is one.
function groupUploads(items) {
  const groups = new Map();
  for (const item of items) {
    const key = bookKey(item);
    const group = groups.get(key);
    if (group) group.others.push(item);
    else groups.set(key, { key, best: item, others: [] });
  }
  for (const group of groups.values()) {
    const i = group.best.cached ? -1 : group.others.findIndex((o) => o.cached);
    if (i >= 0) {
      const [instant] = group.others.splice(i, 1);
      group.others.unshift(group.best);
      group.best = instant;
    }
  }
  return [...groups.values()];
}

function formatOf(item) {
  return (item.format || "").trim().toUpperCase();
}

function greeting(hour) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 22) return "Good evening";
  return "Late-night listening";
}

// What a search result already is in your library, if anything.
function libraryBadge(entry) {
  if (!entry) return null;
  const prog = entry.progress || {};
  if (prog.finished) return "✓ Finished";
  if (entry.downloaded) return "✓ Downloaded";
  if (prog.position > 5 || prog.trackIndex > 0) return `In progress · ${Math.round(audiobookEstimate(entry).percentage)}%`;
  if (entry.saved) return "★ Want to Listen";
  return null;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
  brand: { color: theme.text, fontSize: 22, fontWeight: "800", marginBottom: 14 },
  greetingBox: { marginBottom: 14 },
  today: { color: theme.dim, fontSize: 13, marginTop: 3 },
  todayMore: { color: theme.accent, fontWeight: "700" },
  backRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 10 },
  back: { color: theme.accent, fontSize: 16 },
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
  dlPillTxt: { color: theme.text, fontSize: 13, flex: 1 },
  section: { color: theme.sub, fontWeight: "700", fontSize: 13, textTransform: "uppercase", marginTop: 16, marginBottom: 8 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  sectionAction: { color: theme.accent, fontSize: 12, fontWeight: "600" },
  contCard: { width: 120 },
  savedCard: { width: 96 },
  hero: { borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#ffffff1a", padding: 14, marginTop: 8, backgroundColor: theme.card },
  heroKicker: { color: theme.sub, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginBottom: 10 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  heroTitle: { color: theme.text, fontSize: 17, fontWeight: "700" },
  heroAuthor: { color: theme.sub, marginTop: 2 },
  heroMeta: { color: theme.dim, fontSize: 12, marginTop: 6 },
  heroPlay: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  heroTrack: { height: 4, backgroundColor: "#ffffff1f", borderRadius: 2, marginTop: 14 },
  heroFill: { height: 4, backgroundColor: theme.accent, borderRadius: 2 },
  progressTrack: { height: 3, backgroundColor: theme.border, borderRadius: 2, marginTop: 6 },
  progressFill: { height: 3, backgroundColor: theme.accent, borderRadius: 2 },
  contTitle: { color: theme.text, fontSize: 12, marginTop: 5 },
  contMeta: { color: theme.dim, fontSize: 11, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  chipTxt: { color: theme.text, fontWeight: "600" },
  emptyBox: { alignItems: "center", marginTop: 36, gap: 10, paddingHorizontal: 20 },
  hello: { color: theme.dim, textAlign: "center", lineHeight: 20 },
  row: { flexDirection: "row", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  title: { color: theme.text, fontWeight: "600" },
  author: { color: theme.sub, fontSize: 13, marginTop: 1 },
  meta: { color: theme.dim, fontSize: 12, marginTop: 3 },
  badge: { color: theme.accent, fontSize: 12, fontWeight: "700", marginTop: 3 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  instantTag: {
    color: "#fff", fontSize: 11, fontWeight: "700", backgroundColor: theme.accent2, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 1, marginTop: 3, overflow: "hidden",
  },
  otherRow: { paddingLeft: 24, paddingVertical: 8 },
  moreUploads: { paddingVertical: 8, paddingLeft: 68 },
  moreUploadsTxt: { color: theme.accent, fontWeight: "600", fontSize: 13 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 },
  filterChip: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  filterChipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  filterChipTxt: { color: theme.sub, fontWeight: "600", fontSize: 13 },
  filterChipTxtActive: { color: "#fff" },
  err: { color: "#f87171", textAlign: "center" },
  retry: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  retryTxt: { color: theme.text, fontWeight: "600" },
  more: { alignItems: "center", paddingVertical: 16 },
  moreTxt: { color: theme.accent, fontWeight: "700" },
});
