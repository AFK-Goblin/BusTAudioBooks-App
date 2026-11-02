import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { theme } from "../src/theme";
import { getStreams, getDetails } from "../src/api";
import { resumeOrLoad, playFrom } from "../src/player";
import { upsertBook, getBook, getSavedDetails, saveDetails, setSaved, isStarted, getEmbeddedChapters, listBooks } from "../src/library";
import { seriesOf, ownedCopy, comingLabel } from "../src/series";
import { waitFor, stopWaiting, useWaiting } from "../src/waiting";
import { notificationsAllowed } from "../src/notify";
import { chapterKey, CHAPTER_PARSER_VERSION } from "../src/chapters/index";
import { chapterIndexAt } from "../src/chapters/navigation";
import { cancelDownload } from "../src/downloads";
import { downloadWithSpaceCheck, totalSize } from "../src/downloadPrompt";
import { useDownloads } from "../src/downloadStore";
import { formatBytes, formatDuration, formatTime } from "../src/format";
import { audiobookEstimate } from "../src/playback/progressModel";
import { listenedTo, useListeningStats } from "../src/stats";
import { useSettings } from "../src/settings";
import { CoverArt, CoverBackdrop, GradientButton, PlayPauseIcon } from "../src/ui";
import { ChevronIcon, DownloadIcon, CheckIcon } from "../src/icons";
import { useScreenPad } from "../src/layout";

const POLL_MS = 15_000;
const POLL_LIMIT = 40;
const CONTENTS_PREVIEW = 8;

// "Dune - Frank Herbert [M4B]" → "Dune", for finding other uploads of it.
function plainTitle(title) {
  return String(title || "").replace(/\[[^\]]*\]|\([^)]*\)/g, " ").split(/\s+[-–—]\s+/)[0].replace(/\s+/g, " ").trim();
}

function hasLocalCopy(entry) {
  return !!(entry && entry.downloaded && entry.files && entry.files.length > 0 && entry.files.every((f) => f.uri));
}

export default function BookScreen({ nav, params }) {
  const item = params.item;
  const topPad = useScreenPad();
  const downloads = useDownloads();
  const [entry, setEntry] = useState(undefined); // undefined = still reading the library
  const [state, setState] = useState({ loading: false });
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [listened, setListened] = useState(0); // seconds you've spent in this book
  const [chapterList, setChapterList] = useState(null); // a one-file book's chapters, once read
  const [showAllContents, setShowAllContents] = useState(false);
  const [series, setSeries] = useState(null);
  const [shelf, setShelf] = useState([]); // your library, to mark series books you have
  const waiting = useWaiting().some((w) => w.id === item.id);
  const stats = useListeningStats();
  const settings = useSettings();

  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const polls = useRef(0);

  // quiet: a background re-check while TorBox fetches — no spinner flash, and
  // a failed check keeps showing the last known status.
  async function resolve(quiet = false) {
    if (!quiet) {
      polls.current = 0;
      setState({ loading: true });
    }
    try {
      const r = await getStreams(item.id);
      if (mounted.current) setState({ loading: false, data: r });
    } catch (e) {
      if (mounted.current && !quiet) setState({ loading: false, error: e.message || "Could not resolve" });
    }
  }

  // An uncached torrent is being fetched by TorBox: re-check on our own every
  // 15 s (for up to 10 minutes) so the play buttons appear when it's ready.
  const waitingOnTorBox = !!(state.data && !state.data.ready && !state.loading && !state.error);
  useEffect(() => {
    if (!waitingOnTorBox || polls.current >= POLL_LIMIT) return undefined;
    const timer = setTimeout(() => {
      polls.current += 1;
      resolve(true);
    }, POLL_MS);
    return () => clearTimeout(timer);
    // resolve is recreated every render; the status text is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingOnTorBox, state.data]);

  // Look in the library first: a downloaded book plays offline without asking
  // TorBox for anything; everything else resolves fresh stream links.
  useEffect(() => {
    let alive = true;
    (async () => {
      const existing = await getBook(item.id).catch(() => null);
      if (!alive) return;
      setEntry(existing);
      const saved = existing ? await getSavedDetails(item.id) : null;
      if (alive && saved) setDetails(saved);
      if (!hasLocalCopy(existing)) resolve();
      listenedTo(item.id).then((seconds) => { if (alive) setListened(seconds); }).catch(() => {});
      // Synopsis: best-effort, and remembered on library entries for offline.
      try {
        const fresh = await getDetails(item.id);
        if (!alive || !fresh) return;
        const value = { description: fresh.description || null, genre: fresh.genre || null, year: fresh.year || null };
        if (value.description || value.genre || value.year) {
          setDetails(value);
          if (existing) saveDetails(item.id, value).catch(() => {});
        }
      } catch (_) {
        /* offline, or a server without /app/details */
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // The series this book is in (server 3.1+), and which of it you have.
  useEffect(() => {
    let alive = true;
    seriesOf(item.id).then((value) => { if (alive) setSeries(value); }).catch(() => {});
    listBooks().then((books) => { if (alive) setShelf(books.filter((b) => b.id !== item.id)); }).catch(() => {});
    return () => { alive = false; };
  }, [item.id]);

  // Chapters of a one-file book, as remembered from playing it.
  const firstKey = entry && entry.files && entry.files.length === 1 ? chapterKey(entry.files[0], 0) : null;
  useEffect(() => {
    if (!firstKey) return undefined;
    let alive = true;
    getEmbeddedChapters(item.id).then((stored) => {
      const found = stored[firstKey];
      if (alive && found && found.v === CHAPTER_PARSER_VERSION && Array.isArray(found.chapters) && found.chapters.length > 1) setChapterList(found.chapters);
    }).catch(() => {});
    return () => { alive = false; };
  }, [item.id, firstKey]);

  // A download finishing while this screen is open turns it into the offline view.
  const activeDl = downloads.find((d) => d.id === item.id);
  useEffect(() => {
    if (activeDl) return;
    getBook(item.id).then((value) => { if (value) setEntry(value); }).catch(() => {});
  }, [activeDl, item.id]);

  function bookObject(files) {
    return {
      id: item.id, title: item.title, author: item.author, poster: item.poster,
      format: item.format, files,
    };
  }

  function streamFiles() {
    return (state.data.streams || []).map((s) => ({
      title: s.title, url: s.url, filename: s.filename, ...(s.size > 0 ? { size: s.size } : {}),
    }));
  }

  async function start(fromBeginning) {
    if (busy) return;
    setBusy(true);
    try {
      let book;
      if (hasLocalCopy(entry)) {
        book = entry;
      } else {
        // Keep everything else the entry knows (progress, bookmarks, learned
        // part durations, chapters); only the stream links are new.
        book = await upsertBook({ ...bookObject(streamFiles()), downloaded: false });
      }
      if (details) saveDetails(item.id, details).catch(() => {});
      await resumeOrLoad(book, fromBeginning);
      nav.navigate("player");
    } catch (e) {
      setState((s) => ({ ...s, error: e.message || "Could not start playback" }));
    } finally {
      setBusy(false);
    }
  }

  // Contents: start at a chapter or part instead of where you left off.
  async function startAt(trackIndex, position) {
    if (busy) return;
    setBusy(true);
    try {
      const book = hasLocalCopy(entry) ? entry : await upsertBook({ ...bookObject(streamFiles()), downloaded: false });
      if (details) saveDetails(item.id, details).catch(() => {});
      await playFrom(book, trackIndex, position);
      nav.navigate("player");
    } catch (e) {
      setState((s) => ({ ...s, error: e.message || "Could not start playback" }));
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const files = streamFiles();
    // Identity first (never files — that would drop an existing entry's stream
    // links), so the synopsis has an entry to belong to while it downloads.
    await upsertBook({ id: item.id, title: item.title, author: item.author, poster: item.poster, format: item.format }).catch(() => {});
    if (details) saveDetails(item.id, details).catch(() => {});
    // Runs in the background, tracked globally — unless there's no room for it.
    if (await downloadWithSpaceCheck(bookObject(files), files)) nav.navigate("library");
  }

  // Saved for later; the synopsis is kept with it so the page works offline.
  const saved = !!(entry && entry.saved);
  async function toggleSaved() {
    const updated = await setSaved(item, !saved).catch(() => entry);
    setEntry(updated);
    if (updated && details) saveDetails(item.id, details).catch(() => {});
  }

  const local = hasLocalCopy(entry);
  const ready = state.data && state.data.ready;
  const fileCount = local ? entry.files.length : state.data && state.data.streams ? state.data.streams.length : 0;
  const prog = (entry && entry.progress) || {};
  const started = !prog.finished && (prog.position > 5 || prog.trackIndex > 0);
  const estimate = entry ? audiobookEstimate(entry) : null;
  // "~6 days at your pace": what's left at this book's speed, over your
  // average day of the last 30.
  const perDay = stats ? stats.month / 30 : 0;
  const pace = started && estimate && estimate.remainingSeconds != null && perDay >= 60
    ? Math.max(1, Math.ceil(estimate.remainingSeconds / (prog.rate || settings.speed || 1) / perDay))
    : null;
  const resumeHint = started
    ? estimate && estimate.remainingSeconds != null
      ? `${Math.round(estimate.percentage)}% · ${estimate.estimated ? "~" : ""}${formatDuration(estimate.remainingSeconds)} left${pace ? ` · ~${pace} day${pace === 1 ? "" : "s"} at your pace` : ""}`
      : `at ${formatTime(prog.position)}${fileCount > 1 ? ` in part ${(prog.trackIndex || 0) + 1}` : ""}`
    : null;
  const canPlay = local || ready;
  // The server (3.1+) says when an upload is stalled, paused or failed.
  const stuck = /^(Stalled|Paused|TorBox couldn't)/.test((state.data && state.data.status) || "");
  const partFiles = local ? entry.files : ready ? state.data.streams || [] : [];
  const contents = !canPlay ? [] : chapterList
    ? chapterList.map((c) => ({ title: c.title, trackIndex: 0, position: c.start, time: c.start }))
    : partFiles.length > 1 ? partFiles.map((file, i) => ({ title: file.title || `Part ${i + 1}`, trackIndex: i, position: 0, time: null })) : [];
  const currentRow = !started ? -1 : chapterList ? chapterIndexAt(chapterList, prog.position || 0) : prog.trackIndex || 0;

  return (
    <ScrollView style={[styles.wrap, { paddingTop: topPad }]} contentContainerStyle={{ paddingBottom: 120 }}>
      <TouchableOpacity onPress={nav.goBack} style={styles.backRow}>
        <ChevronIcon dir="left" size={18} color={theme.accent} />
        <Text style={styles.back}>Back</Text>
      </TouchableOpacity>

      <View style={styles.head}>
        <CoverBackdrop uri={item.poster} />
        <View style={styles.coverShadow}>
          <CoverArt uri={item.poster} size={160} radius={12} />
        </View>
        <Text style={styles.title}>{item.title}</Text>
        {item.author ? (
          <TouchableOpacity onPress={() => nav.navigate("search", { query: item.author })} accessibilityRole="link" accessibilityLabel={`More by ${item.author}`}>
            <Text style={[styles.author, styles.authorLink]}>{item.author} ›</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.tags}>
          {item.cached ? <Text style={[styles.tag, styles.tagAccent]}>⚡ Instant</Text> : null}
          {prog.finished ? <Text style={[styles.tag, styles.tagGood]}>✓ Finished</Text> : null}
          {listened >= 60 ? <Text style={styles.tag}>{formatDuration(listened)} listened</Text> : null}
          {[details && details.genre, details && details.year]
            .filter(Boolean)
            .map((value) => <Text key={String(value)} style={styles.tag}>{value}</Text>)}
        </View>
        {entry !== undefined && !(entry && isStarted(entry)) ? (
          <TouchableOpacity
            style={[styles.saveBtn, saved && styles.saveBtnOn]}
            onPress={toggleSaved}
            accessibilityRole="button"
            accessibilityState={{ selected: saved }}
            accessibilityLabel={saved ? "Remove from Want to Listen" : "Add to Want to Listen"}
          >
            <Text style={[styles.saveTxt, saved && styles.saveTxtOn]}>{saved ? "✓ In Want to Listen" : "+ Want to Listen"}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {entry === undefined || (!local && state.loading) ? (
        <View style={styles.box}><ActivityIndicator color={theme.accent} /><Text style={styles.boxTxt}>{entry === undefined ? "Opening…" : "Resolving on TorBox…"}</Text></View>
      ) : !local && state.error ? (
        <View style={styles.box}>
          <Text style={styles.warn}>{state.error}</Text>
          <TouchableOpacity style={styles.retry} onPress={() => resolve()}><Text style={styles.retryTxt}>Retry</Text></TouchableOpacity>
        </View>
      ) : !canPlay ? (
        <View style={styles.box}>
          <Text style={styles.boxTxt}>{(state.data && state.data.status) || "Downloading to TorBox…"}</Text>
          <Text style={styles.dim}>
            {stuck
              ? "This upload isn't moving. Another search result for the same book may be ready sooner."
              : polls.current < POLL_LIMIT
                ? "Not cached yet — TorBox is fetching it. This page checks again on its own."
                : "Not cached yet — TorBox is still fetching it. Try again in a while."}
          </Text>
          <TouchableOpacity style={styles.retry} onPress={() => resolve()}><Text style={styles.retryTxt}>Check now</Text></TouchableOpacity>
          {waiting ? (
            <View style={styles.waitBox}>
              <Text style={styles.waitTxt}>✓ Downloads by itself when TorBox has it</Text>
              <TouchableOpacity onPress={() => stopWaiting(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[styles.linkTxt, { color: theme.dim }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.btnAlt, styles.btnRow, styles.waitBtn]}
              onPress={() => {
                waitFor(item, state.data && state.data.status).then(() => { if (details) saveDetails(item.id, details).catch(() => {}); });
                // So the app can say when it's ready, even while closed.
                if (settings.notifyReady !== false) notificationsAllowed(true).catch(() => {});
              }}
            >
              <DownloadIcon size={15} color={theme.text} />
              <Text style={[styles.btnTxt, { color: theme.text }]}>Download when ready</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.link} onPress={() => nav.navigate("search", { query: plainTitle(item.title) })}>
            <Text style={styles.linkTxt}>Find another upload</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <Text style={styles.dim}>
            {local
              ? "Downloaded · plays offline"
              : `${fileCount} file${fileCount === 1 ? "" : "s"} ready${totalSize(streamFiles()) ? ` · ${formatBytes(totalSize(streamFiles()))}` : ""}`}
          </Text>
          <GradientButton onPress={() => start(false)} disabled={busy} style={{ marginTop: 12 }}>
            <View style={styles.btnRow}>
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <PlayPauseIcon playing={false} size={14} />}
              <Text style={styles.btnTxt}>{started ? "Resume" : local ? "Play" : "Stream now"}</Text>
            </View>
          </GradientButton>
          {resumeHint ? <Text style={styles.hint}>{resumeHint}</Text> : null}
          {started && (
            <TouchableOpacity style={styles.link} onPress={() => start(true)} disabled={busy}>
              <Text style={styles.linkTxt}>Start from the beginning</Text>
            </TouchableOpacity>
          )}
          {local ? (
            <View style={[styles.btnAlt, styles.btnRow, { justifyContent: "center" }]}>
              <CheckIcon size={14} color={theme.good} />
              <Text style={[styles.btnTxt, { color: theme.text }]}>Downloaded</Text>
            </View>
          ) : activeDl && activeDl.status !== "error" ? (
            <View>
              <View style={styles.btnAlt}>
                <Text style={[styles.btnTxt, { color: theme.text }]}>{activeDl.status === "preparing" ? "Preparing download…" : `Downloading… ${activeDl.pct}%`}</Text>
              </View>
              <TouchableOpacity style={styles.link} onPress={() => cancelDownload(item.id).catch(() => {})}>
                <Text style={[styles.linkTxt, { color: theme.dim }]}>Cancel download</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.btnAlt} onPress={download}>
              <View style={styles.btnRow}>
                <DownloadIcon size={15} color={theme.text} />
                <Text style={[styles.btnTxt, { color: theme.text }]}>Download for offline</Text>
              </View>
            </TouchableOpacity>
          )}
          {!local && <Text style={styles.hint}>Downloads keep going in the background — watch progress in your Library.</Text>}
        </View>
      )}

      {details && details.description ? (
        <View style={styles.about}>
          <Text style={styles.aboutHead}>About this book</Text>
          <Text style={styles.aboutTxt} numberOfLines={expanded ? undefined : 6}>{details.description}</Text>
          {details.description.length > 280 && (
            <TouchableOpacity onPress={() => setExpanded((v) => !v)} style={styles.moreBtn}>
              <Text style={styles.linkTxt}>{expanded ? "Show less" : "Show more"}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}

      {[item.format, item.bitrate, item.sizeText].some(Boolean) ? (
        <View style={styles.about}>
          <Text style={styles.aboutHead}>Edition details</Text>
          <View style={[styles.tags, { justifyContent: "flex-start", marginTop: 0 }]}>
            {[item.format, item.bitrate, item.sizeText].filter(Boolean).map((value, index) => <Text key={`${index}:${value}`} style={styles.tag}>{value}</Text>)}
          </View>
        </View>
      ) : null}

      {contents.length > 0 ? (
        <View style={styles.about}>
          <Text style={styles.aboutHead}>Contents · {contents.length} {chapterList ? "chapters" : "parts"}</Text>
          {contents.slice(0, showAllContents ? contents.length : CONTENTS_PREVIEW).map((row, i) => (
            <TouchableOpacity
              key={`${i}:${row.title}`}
              style={styles.tocRow}
              onPress={() => startAt(row.trackIndex, row.position)}
              disabled={busy}
              accessibilityLabel={`Play from ${row.title}`}
            >
              <Text style={[styles.tocNum, i === currentRow && styles.tocCurrent]}>{i + 1}</Text>
              <Text style={[styles.tocTitle, i === currentRow && styles.tocCurrent]} numberOfLines={1}>{row.title}</Text>
              {row.time != null ? <Text style={styles.tocTime}>{formatTime(row.time)}</Text> : null}
            </TouchableOpacity>
          ))}
          {contents.length > CONTENTS_PREVIEW ? (
            <TouchableOpacity onPress={() => setShowAllContents((v) => !v)} style={styles.moreBtn}>
              <Text style={styles.linkTxt}>{showAllContents ? "Show fewer" : `Show all ${contents.length}`}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {series ? (
        <View style={styles.about}>
          <Text style={styles.aboutHead}>{series.name} · Book {series.position} of {series.total}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
            {series.books.map((b) => {
              const owned = b.current ? null : ownedCopy(b, shelf);
              const label = b.current ? "This book"
                : owned ? (owned.progress && owned.progress.finished ? "✓ Finished" : "In your library")
                  : b.upcoming ? comingLabel(b.released) : null;
              return (
                <TouchableOpacity
                  key={`${b.position}:${b.title}`}
                  style={styles.seriesCard}
                  disabled={b.current || (b.upcoming && !owned)}
                  onPress={() => (owned ? nav.navigate("book", { item: owned }) : nav.navigate("search", { query: b.search || b.title }))}
                  accessibilityLabel={`Book ${b.position}: ${b.title}${label ? `, ${label}` : ""}`}
                >
                  <View style={[styles.seriesCover, b.current && styles.seriesCurrent, b.upcoming && !owned && { opacity: 0.5 }]}>
                    <CoverArt uri={b.poster} size={92} radius={8} />
                  </View>
                  <Text style={styles.seriesNum}>#{b.position}</Text>
                  <Text style={styles.seriesTitle} numberOfLines={2}>{b.title}</Text>
                  {label ? <Text style={[styles.seriesLabel, b.current && { color: theme.accent }]} numberOfLines={1}>{label}</Text> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}


    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 14 },
  back: { color: theme.accent, fontSize: 16 },
  head: { alignItems: "center", marginHorizontal: -16, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20, marginBottom: 8, overflow: "hidden" },
  coverShadow: {
    borderRadius: 12, elevation: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45, shadowRadius: 14, backgroundColor: theme.card, marginBottom: 16,
  },
  title: { color: theme.text, fontSize: 20, fontWeight: "800", textAlign: "center" },
  tags: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: 12 },
  tag: {
    color: theme.sub, fontSize: 12, fontWeight: "600", backgroundColor: "#ffffff12", borderWidth: 1,
    borderColor: "#ffffff1f", borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3, overflow: "hidden",
  },
  tagAccent: { color: "#fff", backgroundColor: theme.accent2, borderColor: theme.accent },
  tagGood: { color: theme.good, borderColor: theme.good + "55" },
  saveBtn: { minHeight: 48, justifyContent: "center", marginTop: 14, borderRadius: 16, borderWidth: 1, borderColor: theme.accent, paddingHorizontal: 14, paddingVertical: 6 },
  saveBtnOn: { backgroundColor: theme.button },
  saveTxt: { color: theme.accent, fontWeight: "700", fontSize: 13 },
  saveTxtOn: { color: "#fff" },
  author: { color: theme.sub, marginTop: 4, textAlign: "center" },
  authorLink: { color: theme.accent },
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
  retry: { minHeight: 48, justifyContent: "center", marginTop: 10, paddingHorizontal: 18, paddingVertical: 8, backgroundColor: theme.button, borderRadius: 8 },
  retryTxt: { color: "#fff", fontWeight: "600" },
  hint: { color: theme.dim, fontSize: 12, textAlign: "center", marginTop: 10 },
  link: { alignSelf: "center", paddingVertical: 8, paddingHorizontal: 12, marginTop: 2 },
  about: { marginTop: 28 },
  aboutHead: { color: theme.sub, fontWeight: "700", fontSize: 13, textTransform: "uppercase", marginBottom: 8 },
  aboutTxt: { color: theme.text, lineHeight: 21 },
  moreBtn: { minHeight: 48, justifyContent: "center", paddingVertical: 8 },
  seriesCard: { width: 96 },
  seriesCover: { borderRadius: 10, borderWidth: 2, borderColor: "transparent", alignSelf: "flex-start" },
  seriesCurrent: { borderColor: theme.accent },
  seriesNum: { color: theme.dim, fontSize: 11, fontWeight: "700", marginTop: 5 },
  seriesTitle: { color: theme.text, fontSize: 12, marginTop: 1 },
  seriesLabel: { color: theme.sub, fontSize: 11, marginTop: 2 },
  waitBtn: { alignSelf: "stretch", justifyContent: "center", paddingHorizontal: 16 },
  waitBox: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 },
  waitTxt: { color: theme.good, fontWeight: "600", fontSize: 13 },
  tocRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: theme.border },
  tocNum: { color: theme.dim, width: 24, textAlign: "right", fontVariant: ["tabular-nums"] },
  tocTitle: { color: theme.text, flex: 1 },
  tocTime: { color: theme.dim, fontSize: 12, fontVariant: ["tabular-nums"] },
  tocCurrent: { color: theme.accent, fontWeight: "700" },
  linkTxt: { color: theme.accent, fontWeight: "600" },
});
