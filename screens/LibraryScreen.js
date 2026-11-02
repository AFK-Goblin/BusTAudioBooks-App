import React, { useEffect, useState, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SectionList, ScrollView, Alert, useWindowDimensions } from "react-native";
import { theme } from "../src/theme";
import {
  librarySections, getLibrary, removeBook,
  setFinished, resetProgress, setSaved, isStarted, setRating,
} from "../src/library";
import { freeDownload } from "../src/freeDownload";
import { deleteDownload, retryDownload, cancelDownload } from "../src/downloads";
import { useDownloads, dismissTracking } from "../src/downloadStore";
import { useWaiting, stopWaiting } from "../src/waiting";
import { rememberedSeries, fillSeries } from "../src/series";
import { resumeOrLoad, getCurrentBook, closeBook } from "../src/player";
import { formatTime, formatDuration, formatBytes } from "../src/format";
import { audiobookEstimate } from "../src/playback/progressModel";
import { CoverArt, ActionSheet, Sheet, Stars, starText } from "../src/ui";
import { DotsIcon, NoteGlyph, CloseIcon, SearchIcon, ChevronIcon } from "../src/icons";
import { useScreenPad } from "../src/layout";
import { useSettings, setSetting } from "../src/settings";
import { useListeningStats } from "../src/stats";

export default function LibraryScreen({ nav }) {
  const [sections, setSections] = useState([]);
  const [bookmarkCount, setBookmarkCount] = useState(0);
  const [seriesLabels, setSeriesLabels] = useState({}); // id -> { name, position }
  const [menuFor, setMenuFor] = useState(null); // the entry whose actions are open
  const [rateFor, setRateFor] = useState(null); // the entry being rated
  const [filter, setFilter] = useState("");
  const [libraryView, setLibraryView] = useState("all");
  const settings = useSettings();
  const stats = useListeningStats();
  const downloads = useDownloads();
  const waiting = useWaiting();
  const topPad = useScreenPad();
  const { width } = useWindowDimensions();

  const load = useCallback(async () => {
    const { continueListening: cont, wantToListen: want, downloads: dls, finished: fin, bookmarkCount: marks } = await librarySections();
    setBookmarkCount(marks);
    const s = [];
    if (cont.length) s.push({ title: "Continue Listening", data: cont, kind: "continue" });
    if (want.length) s.push({ title: "Want to Listen", data: want, kind: "saved" });
    if (dls.length) s.push({ title: "Downloads", data: dls, kind: "download" });
    if (fin.length) s.push({ title: "Finished", data: fin, kind: "finished" });
    setSections(s);
    // Series labels: what's remembered now, then a few more looked up.
    const ids = [...new Set(s.flatMap((section) => section.data.map((b) => b.id)))];
    setSeriesLabels(await rememberedSeries(ids));
    if (await fillSeries(ids).catch(() => 0)) setSeriesLabels(await rememberedSeries(ids));
  }, []);

  useEffect(() => { load(); }, [load]);
  // Reload the downloaded list whenever the active-download set changes (e.g. one finishes).
  useEffect(() => { load(); }, [downloads.length, load]);

  // Title/author filter, offered once the library is big enough to need it.
  const total = sections.reduce((n, section) => n + section.data.length, 0);
  const needle = filter.trim().toLowerCase();
  const sort = SORTS.find((s) => s.key === settings.librarySort) || SORTS[0];
  // The All view separates finished books, but offline availability spans both shelves.
  const offlineBooks = sections.filter((section) => section.kind === "download" || section.kind === "finished")
    .flatMap((section) => section.data).filter((book) => book.downloaded)
    .sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0));
  const selectedSections = libraryView === "downloaded" ? [{ title: "Downloads", kind: "download", data: offlineBooks }]
    : libraryView === "saved" ? sections.filter((section) => section.kind === "saved")
      : libraryView === "transfers" ? [] : sections;
  const matches = (book) => !needle || `${book.title || ""} ${book.author || ""}`.toLowerCase().includes(needle);
  const showTransfers = libraryView === "all" || libraryView === "transfers";
  const visibleWaiting = showTransfers ? waiting.filter(matches) : [];
  const visibleDownloads = showTransfers ? downloads.filter(matches) : [];
  const sorted = sort.compare ? selectedSections.map((section) => ({ ...section, data: [...section.data].sort(sort.compare) })) : selectedSections;
  // Folded sections keep their header (with a count) so they can be opened
  // again; a filter shows matches everywhere.
  const collapsed = Array.isArray(settings.libraryCollapsed) ? settings.libraryCollapsed : [];
  const shown = needle || libraryView !== "all"
    ? sorted
      .map((section) => ({
        ...section,
        data: section.data.filter((b) => `${b.title || ""} ${b.author || ""}`.toLowerCase().includes(needle)),
      }))
      .filter((section) => section.data.length > 0)
    : sorted.map((section) => (collapsed.includes(section.kind) ? { ...section, count: section.data.length, data: [] } : section));

  // Grid view: each section's books three to a row.
  const grid = settings.libraryView === "grid";
  const cell = Math.floor((width - 32 - 2 * GRID_GAP) / 3);
  const display = grid ? shown.map((section) => ({ ...section, data: rowsOf(section.data, 3) })) : shown;

  function toggleSection(kind) {
    setSetting("libraryCollapsed", collapsed.includes(kind) ? collapsed.filter((k) => k !== kind) : [...collapsed, kind]);
  }

  async function play(book, fromStart = false) {
    const lib = await getLibrary();
    const fresh = lib[book.id] || book;
    if (!fresh.files || fresh.files.length === 0) {
      // Not downloaded and no cached stream URLs — send to detail to re-resolve.
      nav.navigate("book", { item: fresh });
      return;
    }
    try {
      await resumeOrLoad(fresh, fromStart);
      nav.navigate("player");
    } catch (_) {
      nav.navigate("book", { item: fresh });
    }
  }

  // Progress edits on the book that is loaded in the player would be
  // overwritten by its next checkpoint (and deleting its files would cut
  // playback off), so close it first.
  async function releaseIfPlaying(id) {
    const current = getCurrentBook();
    if (current && current.id === id) await closeBook().catch(() => {});
  }

  // Frees the files only — progress, bookmarks and the library entry stay, so
  // the book can be streamed or downloaded again from where it was.
  function confirmDelete(book) {
    Alert.alert("Delete download?", `Free the space used by "${book.title}"? Your progress and bookmarks are kept.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          await freeDownload(book.id);
          load();
        },
      },
    ]);
  }

  function confirmCancel(d) {
    Alert.alert("Cancel download?", `Stop downloading "${d.title}" and delete what has arrived so far?`, [
      { text: "Keep downloading", style: "cancel" },
      { text: "Cancel download", style: "destructive", onPress: () => cancelDownload(d.id).catch(() => {}) },
    ]);
  }

  function confirmRemove(book) {
    Alert.alert(
      "Remove from library?",
      `"${book.title}" will disappear from your library along with its progress and bookmarks${book.downloaded ? ", and its downloaded files will be deleted" : ""}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove", style: "destructive",
          onPress: async () => {
            await releaseIfPlaying(book.id);
            if (book.downloaded) await deleteDownload(book.id);
            await removeBook(book.id);
            load();
          },
        },
      ],
    );
  }

  function actionsFor(item) {
    if (!item) return [];
    const prog = item.progress || {};
    const started = prog.position > 5 || prog.trackIndex > 0;
    if (item.saved && !isStarted(item)) {
      return [
        { label: "Book details", hint: "Stream or download it", onPress: () => nav.navigate("book", { item }) },
        { label: "Remove from Want to Listen", destructive: true, onPress: async () => { await setSaved(item, false); load(); } },
      ];
    }
    const actions = [];
    if (started && !prog.finished) {
      actions.push({ label: "Play from the beginning", onPress: () => play(item, true) });
    }
    if (prog.finished) {
      actions.push({ label: item.rating ? "Change your rating" : "Rate this book", hint: starText(item.rating) || null, onPress: () => setRateFor(item) });
    }
    actions.push(prog.finished
      ? { label: "Mark as not finished", hint: "Back to Continue Listening", onPress: async () => { await releaseIfPlaying(item.id); await setFinished(item.id, false); load(); } }
      : { label: "Mark as finished", onPress: async () => { await releaseIfPlaying(item.id); await setFinished(item.id, true); load(); } });
    if (started) {
      actions.push({ label: "Reset progress", hint: "Start over next time; bookmarks are kept", onPress: async () => { await releaseIfPlaying(item.id); await resetProgress(item.id); load(); } });
    }
    actions.push({ label: "Book details", hint: item.downloaded ? null : "Stream or download it again", onPress: () => nav.navigate("book", { item }) });
    if (item.downloaded) {
      actions.push({ label: "Delete download", hint: "Keeps progress and bookmarks", destructive: true, onPress: () => confirmDelete(item) });
    }
    actions.push({ label: "Remove from library", destructive: true, onPress: () => confirmRemove(item) });
    return actions;
  }

  return (
    <View style={[styles.wrap, { paddingTop: topPad }]}>
      <View style={styles.headRow}>
        <Text style={styles.brand}>Library</Text>
        <View style={styles.headActions}>
          {bookmarkCount > 0 ? (
            <TouchableOpacity style={styles.sortBtn} onPress={() => nav.navigate("bookmarks")} accessibilityLabel={`All bookmarks (${bookmarkCount})`}>
              <Text style={styles.sortTxt}>Bookmarks</Text>
            </TouchableOpacity>
          ) : null}
          {total > 1 ? (
            <TouchableOpacity
              style={styles.sortBtn}
              onPress={() => setSetting("librarySort", SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length].key)}
              accessibilityLabel={`Sorted by ${sort.label}. Change sort order`}
            >
              <Text style={styles.sortTxt}>Sort: {sort.label}</Text>
            </TouchableOpacity>
          ) : null}
          {total > 0 ? (
            <TouchableOpacity
              style={styles.sortBtn}
              onPress={() => setSetting("libraryView", grid ? "list" : "grid")}
              accessibilityLabel={grid ? "Show as a list" : "Show as a grid of covers"}
            >
              <Text style={styles.sortTxt}>{grid ? "List" : "Grid"}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      {stats && stats.total >= 60 ? (
        <TouchableOpacity onPress={() => nav.navigate("stats")} accessibilityRole="button" accessibilityHint="Opens your listening stats">
          <Text style={styles.statsLine}>
            Today {formatDuration(stats.today)}{settings.dailyGoal ? ` of ${settings.dailyGoal}m` : ""} · Last 7 days {formatDuration(stats.week)}
            {stats.streak >= 2 ? ` · ${stats.streak}-day streak` : ""} <Text style={styles.statsMore}>›</Text>
          </Text>
        </TouchableOpacity>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.views} contentContainerStyle={styles.viewOptions}>
        {[["all", "All"], ["downloaded", "Downloaded"], ["saved", "Want to Listen"], ["transfers", "Transfers"]].map(([key, label]) => (
          <TouchableOpacity key={key} style={[styles.viewChip, libraryView === key && styles.viewChipActive]} onPress={() => setLibraryView(key)} accessibilityRole="button" accessibilityState={{ selected: libraryView === key }} accessibilityLabel={`Library view: ${label}`}>
            <Text style={[styles.viewText, libraryView === key && { color: theme.text }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {total >= FILTER_THRESHOLD || needle || libraryView === "transfers" ? (
        <View style={styles.filterWrap}>
          <SearchIcon size={16} color={theme.dim} />
          <TextInput
            style={styles.filterInput}
            placeholder="Filter your library"
            placeholderTextColor={theme.dim}
            value={filter}
            onChangeText={setFilter}
            autoCorrect={false}
            returnKeyType="search"
          />
          {filter ? (
            <TouchableOpacity onPress={() => setFilter("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Clear filter">
              <CloseIcon size={12} color={theme.dim} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <SectionList
        sections={display}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ paddingBottom: 90 }}
        ListHeaderComponent={
          visibleWaiting.length > 0 || visibleDownloads.length > 0 ? (
            <View>
              {visibleWaiting.length > 0 ? <Text style={styles.section}>Waiting on TorBox</Text> : null}
              {visibleWaiting.map((w) => (
                <TouchableOpacity key={w.id} style={styles.dlRow} onPress={() => nav.navigate("book", { item: w })}>
                  <CoverArt uri={w.poster} size={52} radius={6} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={2}>{w.title}</Text>
                    <Text style={styles.meta} numberOfLines={2}>{w.status || "Waiting on TorBox"}</Text>
                    <Text style={styles.meta}>{`Downloads by itself once it's ready · checked ${checkedAgo(w.checkedAt)}`}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.moreBtn}
                    onPress={() => stopWaiting(w.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={`Stop waiting for ${w.title}`}
                  >
                    <CloseIcon size={14} color={theme.dim} />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
              {visibleDownloads.length > 0 ? <Text style={styles.section}>Transfers</Text> : null}
              {visibleDownloads.map((d) => (
                <View key={d.id} style={styles.dlRow}>
                  <CoverArt uri={d.poster} size={52} radius={6} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={2}>{d.title}</Text>
                    {d.status === "error" ? (
                      <View>
                        <Text style={styles.dlErr}>Failed — {d.error || "download error"}</Text>
                        <View style={styles.errBtns}>
                          <TouchableOpacity style={styles.errBtn} onPress={() => retryDownload(d)}>
                            <Text style={styles.errBtnTxt}>Retry</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.errBtn, styles.errBtnAlt]} onPress={() => dismissTracking(d.id)}>
                            <Text style={[styles.errBtnTxt, { color: theme.dim }]}>Dismiss</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : d.status === "preparing" ? (
                      <Text style={styles.meta}>Preparing download{settings.wifiOnly ? " · Wi-Fi only enabled" : ""}</Text>
                    ) : (
                      <>
                        <Text style={styles.meta}>
                          {d.pct}%
                          {d.bytesTotal ? ` · ${formatBytes(d.bytesDone)} of ${formatBytes(d.bytesTotal)}` : ""}
                          {d.count > 1 ? ` · file ${d.i + 1}/${d.count}` : ""}
                        </Text>
                        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${d.pct}%` }]} /></View>
                      </>
                    )}
                  </View>
                  {d.status !== "error" && (
                    <TouchableOpacity
                      style={styles.moreBtn}
                      onPress={() => confirmCancel(d)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel={`Cancel download of ${d.title}`}
                    >
                      <CloseIcon size={14} color={theme.dim} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => {
          const folded = section.count != null;
          return (
            <TouchableOpacity
              style={styles.sectionBtn}
              onPress={() => toggleSection(section.kind)}
              disabled={!!needle || libraryView !== "all"}
              accessibilityRole="button"
              accessibilityState={{ expanded: !folded }}
              accessibilityLabel={`${section.title}${folded ? `, ${section.count} hidden` : ""}`}
            >
              <Text style={styles.sectionTxt}>{section.title}{folded ? ` · ${section.count}` : ""}</Text>
              {needle ? null : <ChevronIcon dir={folded ? "right" : "down"} size={12} color={theme.dim} />}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          needle ? (
            <View style={styles.emptyBox}>
              <Text style={styles.empty}>Nothing in your library matches “{filter.trim()}”.</Text>
            </View>
          ) : visibleDownloads.length === 0 && visibleWaiting.length === 0 ? (
            <View style={styles.emptyBox}>
              <NoteGlyph size={38} color={theme.border} />
              <Text style={styles.empty}>{libraryView === "transfers" ? "No downloads in progress" : libraryView === "downloaded" ? "No offline books yet" : libraryView === "saved" ? "Your next listen starts here" : "Nothing here yet."}</Text>
              <Text style={styles.empty}>{libraryView === "saved" ? "Save a book to Want to Listen to find it here." : "Find a book to stream or download for offline listening."}</Text>
              <TouchableOpacity style={styles.emptyAction} onPress={() => nav.reset("search")} accessibilityRole="button"><Text style={styles.errBtnTxt}>Find a book</Text></TouchableOpacity>
            </View>
          ) : null
        }
        renderItem={({ item, section }) => {
          if (item.books) {
            return (
              <View style={styles.gridRow}>
                {item.books.map((book) => (
                  <GridCell
                    key={book.id}
                    book={book}
                    kind={section.kind}
                    size={cell}
                    onPress={() => play(book, section.kind === "finished")}
                    onLongPress={() => setMenuFor(book)}
                  />
                ))}
              </View>
            );
          }
          const prog = item.progress || {};
          const estimate = audiobookEstimate(item);
          const pct = Math.round(estimate.percentage);
          const left = estimate.remainingSeconds != null
            ? ` · ${estimate.estimated ? "~" : ""}${formatDuration(estimate.remainingSeconds)} left`
            : "";
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => play(item, section.kind === "finished")}
              onLongPress={() => setMenuFor(item)}
            >
              <CoverArt uri={item.poster} size={52} radius={6} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                {item.author || seriesLabels[item.id] ? (
                  <Text style={styles.author} numberOfLines={1}>
                    {[item.author, seriesLabels[item.id] ? `${seriesLabels[item.id].name} #${seriesLabels[item.id].position}` : null].filter(Boolean).join(" · ")}
                  </Text>
                ) : null}
                <Text style={styles.meta}>
                  {section.kind === "continue"
                    ? `${pct}%${left}${(item.files || []).length > 1 ? ` · part ${(prog.trackIndex || 0) + 1}/${item.files.length}` : ` · ${formatTime(prog.position)}`}`
                    : section.kind === "finished"
                      ? `${item.rating ? `${starText(item.rating)} · ` : ""}Finished${item.downloaded ? " · Downloaded" : ""} — tap to listen again`
                      : section.kind === "saved"
                        ? `Saved ${savedAgo(item.savedAt)}${item.downloaded ? " · Downloaded" : ""}`
                        : item.downloaded ? `Downloaded${sizeOf(item) ? ` · ${formatBytes(sizeOf(item))}` : ""}` : ""}
                </Text>
                {section.kind === "continue" ? (
                  <View style={styles.rowTrack}><View style={[styles.rowFill, { width: `${pct}%` }]} /></View>
                ) : null}
              </View>
              <TouchableOpacity style={styles.moreBtn} onPress={() => setMenuFor(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={`More actions for ${item.title}`}>
                <DotsIcon size={18} color={theme.dim} />
              </TouchableOpacity>
            </TouchableOpacity>
          );
        }}
      />
      <Sheet visible={!!rateFor} onClose={() => setRateFor(null)} title={rateFor ? rateFor.title : ""}>
        <View style={styles.rateBox}>
          <Stars
            size={36}
            value={(rateFor && rateFor.rating) || 0}
            onChange={async (stars) => {
              const updated = await setRating(rateFor.id, stars);
              setRateFor(updated);
              load();
            }}
          />
          <Text style={styles.rateHint}>Tap a star to rate; tap it again to clear.</Text>
        </View>
      </Sheet>
      <ActionSheet
        visible={!!menuFor}
        onClose={() => setMenuFor(null)}
        title={menuFor ? menuFor.title : ""}
        actions={actionsFor(menuFor)}
      />
    </View>
  );
}

const FILTER_THRESHOLD = 8;
const GRID_GAP = 12;

function rowsOf(books, size) {
  const rows = [];
  for (let i = 0; i < books.length; i += size) {
    const chunk = books.slice(i, i + size);
    rows.push({ id: `row:${chunk.map((b) => b.id).join("|")}`, books: chunk });
  }
  return rows;
}

// A cover in the grid view. Long-press for the same actions as the list's ⋯.
function GridCell({ book, kind, size, onPress, onLongPress }) {
  const pct = kind === "continue" ? Math.round(audiobookEstimate(book).percentage) : null;
  return (
    <TouchableOpacity
      style={{ width: size }}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityLabel={`${book.title}${pct != null ? `, ${pct}% listened` : kind === "finished" ? ", finished" : ""}`}
      accessibilityHint="Long-press for more actions"
    >
      <View>
        <CoverArt uri={book.poster} size={size} radius={8} />
        {kind === "finished" ? <Text style={styles.gridBadge}>✓</Text> : null}
      </View>
      {pct != null ? <View style={styles.gridTrack}><View style={[styles.rowFill, { width: `${pct}%` }]} /></View> : null}
      <Text style={styles.gridTitle} numberOfLines={2}>{book.title}</Text>
    </TouchableOpacity>
  );
}

// Library order within each section. "Recent" keeps each section's own order
// (last played, last downloaded); the others are alphabetical.
const byText = (pick) => (a, b) => (pick(a) || "\uffff").localeCompare(pick(b) || "\uffff", undefined, { sensitivity: "base", numeric: true });
const SORTS = [
  { key: "recent", label: "Recent", compare: null },
  { key: "title", label: "Title", compare: byText((b) => b.title) },
  { key: "author", label: "Author", compare: (a, b) => byText((x) => x.author)(a, b) || byText((x) => x.title)(a, b) },
];

function checkedAgo(ms) {
  const minutes = Math.floor((Date.now() - (ms || 0)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

function savedAgo(ms) {
  const daysAgo = Math.floor((Date.now() - (ms || 0)) / 86_400_000);
  if (!ms || daysAgo < 0) return "for later";
  if (daysAgo === 0) return "today";
  if (daysAgo === 1) return "yesterday";
  return daysAgo < 30 ? `${daysAgo} days ago` : daysAgo < 365 ? `${Math.floor(daysAgo / 30)} mo ago` : "a while ago";
}

// Bytes on disk for a download, when its files recorded sizes (3.1+).
function sizeOf(item) {
  const files = item.files || [];
  return files.length > 0 && files.every((f) => f.size > 0) ? files.reduce((n, f) => n + f.size, 0) : 0;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
  brand: { color: theme.text, fontSize: 22, fontWeight: "800", marginBottom: 10 },
  headRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between" },
  views: { flexGrow: 0, marginBottom: 8 },
  viewOptions: { gap: 8, paddingVertical: 2 },
  viewChip: { minHeight: 48, justifyContent: "center", paddingHorizontal: 14, borderRadius: 24, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border },
  viewChipActive: { borderColor: theme.accent, backgroundColor: theme.accent2 },
  viewText: { color: theme.sub, fontWeight: "600" },
  emptyAction: { minHeight: 48, justifyContent: "center", paddingHorizontal: 18, borderRadius: 12, backgroundColor: theme.button },
  sortBtn: { minHeight: 48, justifyContent: "center", paddingVertical: 4, paddingHorizontal: 6 },
  sortTxt: { color: theme.accent, fontWeight: "600", fontSize: 13 },
  statsLine: { color: theme.dim, fontSize: 12, marginTop: -6, marginBottom: 8 },
  statsMore: { color: theme.accent, fontWeight: "700" },
  filterWrap: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingHorizontal: 12, height: 40, marginBottom: 4,
  },
  filterInput: { flex: 1, color: theme.text, height: 40 },
  section: { color: theme.sub, fontWeight: "700", fontSize: 13, textTransform: "uppercase", marginTop: 18, marginBottom: 6 },
  sectionBtn: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6, marginTop: 18, marginBottom: 6, backgroundColor: theme.bg },
  sectionTxt: { color: theme.sub, fontWeight: "700", fontSize: 13, textTransform: "uppercase" },
  headActions: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  row: { flexDirection: "row", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border, alignItems: "center" },
  dlRow: { flexDirection: "row", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border, alignItems: "center" },
  progressTrack: { height: 4, backgroundColor: theme.border, borderRadius: 2, marginTop: 6 },
  progressFill: { height: 4, backgroundColor: theme.accent, borderRadius: 2 },
  rowTrack: { height: 3, backgroundColor: theme.border, borderRadius: 2, marginTop: 7, marginRight: 8 },
  rowFill: { height: 3, backgroundColor: theme.accent, borderRadius: 2 },
  gridRow: { flexDirection: "row", gap: GRID_GAP, paddingVertical: 8 },
  gridTrack: { height: 3, backgroundColor: theme.border, borderRadius: 2, marginTop: 6 },
  gridTitle: { color: theme.text, fontSize: 12, marginTop: 5 },
  gridBadge: {
    position: "absolute", top: 6, right: 6, color: "#fff", fontSize: 12, fontWeight: "800", overflow: "hidden",
    backgroundColor: theme.good, borderRadius: 10, width: 20, height: 20, textAlign: "center", lineHeight: 20,
  },
  dlErr: { color: "#f87171", fontSize: 12, marginTop: 3 },
  errBtns: { flexDirection: "row", gap: 8, marginTop: 8 },
  errBtn: { minHeight: 48, justifyContent: "center", backgroundColor: theme.button, borderRadius: 7, paddingHorizontal: 12, paddingVertical: 5 },
  errBtnAlt: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.border },
  errBtnTxt: { color: "#fff", fontWeight: "600", fontSize: 12 },
  title: { color: theme.text, fontWeight: "600" },
  author: { color: theme.sub, fontSize: 13, marginTop: 1 },
  meta: { color: theme.dim, fontSize: 12, marginTop: 3 },
  moreBtn: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center", padding: 6 },
  emptyBox: { alignItems: "center", marginTop: 60, gap: 10, paddingHorizontal: 30 },
  rateBox: { alignItems: "center", paddingVertical: 14, gap: 10 },
  rateHint: { color: theme.dim, fontSize: 12 },
  empty: { color: theme.dim, textAlign: "center", lineHeight: 20 },
});
