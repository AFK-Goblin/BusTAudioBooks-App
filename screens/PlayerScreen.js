import React, { useState, useEffect, useCallback, useRef, memo } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Switch, Share, useWindowDimensions } from "react-native";
import Slider from "@react-native-community/slider";
import TrackPlayer, { useProgress, useIsPlaying, useActiveMediaItem } from "@rntp/player";
import { theme } from "../src/theme";
import { formatTime, formatDuration, formatSpeed, parseTime } from "../src/format";
import { usePlaybackSnapshot, setRate, setSleep, play, pause, seekTo, seekBy, skipToIndex, retryPlayback, closeBook } from "../src/player";
import { CoverBackdrop, CoverArt, PlayPauseIcon, Sheet, ActionSheet, Stars, useClock } from "../src/ui";
import { ChevronIcon, SkipIcon, JumpIcon, DownloadIcon, CheckIcon, CloseIcon, DotsIcon } from "../src/icons";
import { LinearGradient } from "expo-linear-gradient";
import { downloadWithSpaceCheck } from "../src/downloadPrompt";
import { useDownloads } from "../src/downloadStore";
import { getBook, addBookmark, removeBookmark, setBookmarkNote, setFinished, setRating, listBooks, wantToListen } from "../src/library";
import { useSettings, setSetting, SPEED_PRESETS, SPEED_MIN, SPEED_MAX, SLEEP_FADE_SECONDS } from "../src/settings";
import { useScreenPad } from "../src/layout";
import { useEmbeddedChapters } from "../src/chapters/useEmbeddedChapters";
import { chapterIndexAt, chapterEnd, nextChapterTarget, previousStep, nextStep } from "../src/chapters/navigation";
import { audiobookEstimate } from "../src/playback/progressModel";
import { bookmarksText } from "../src/bookmarks";
import { seriesOf, ownedCopy } from "../src/series";

const SLEEP_MINUTES = [5, 10, 15, 30, 45, 60, 90];
// Jumps at least this far (or to another part) can be undone for a few seconds.
const UNDO_MIN_SECONDS = 60;
const UNDO_SHOW_MS = 8000;
// Chapter/part sheets longer than this get a search box.
const SEARCHABLE_LIST = 20;

function roundSpeed(value) {
  return Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, value)) * 20) / 20;
}


export default function PlayerScreen({ nav }) {
  const progress = useProgress();
  const playing = useIsPlaying();
  const track = useActiveMediaItem();
  const snapshot = usePlaybackSnapshot();
  const book = snapshot.book;
  const rate = snapshot.rate || 1;
  const sleep = snapshot.sleep || { mode: "off" };
  const settings = useSettings();
  const topPad = useScreenPad();
  const [seek, setSeek] = useState(null);
  const [entry, setEntry] = useState(null);
  const [bmFlash, setBmFlash] = useState(false);
  const [sheet, setSheet] = useState(null); // "chapters" | "speed" | "sleep" | "note"
  const [editing, setEditing] = useState(null); // { bookmark, text } while editing a note
  const [menu, setMenu] = useState(false);
  const [gotoText, setGotoText] = useState("");
  const [gotoError, setGotoError] = useState(null);
  const [chapterFilter, setChapterFilter] = useState("");
  const { width } = useWindowDimensions();
  const coverSize = Math.max(180, Math.min(width - 96, 300));
  const downloads = useDownloads();

  const files = (book && book.files) || [];
  const activeIdx = track && track.extras ? Number(track.extras.trackIndex) || 0 : snapshot.activeTrackIndex || 0;
  const chapters = useEmbeddedChapters(book, activeIdx);
  const bookmarks = (entry && entry.bookmarks) || [];
  const downloaded = !!(entry && entry.downloaded);
  const now = useClock(sleep.mode === "timer");

  // The library entry carries bookmarks, the downloaded flag and the part
  // durations learned so far (for whole-book time left).
  const bookId = book ? book.id : null;
  const downloadCount = downloads.length;
  useEffect(() => {
    if (!bookId) return undefined;
    let alive = true;
    getBook(bookId).then((value) => { if (alive) setEntry(value); });
    return () => { alive = false; };
  }, [bookId, downloadCount]);

  // Can we download what we're streaming? (Has HTTPS stream URLs, not already local/downloaded.)
  const isStreamable = files.length > 0 && files.every((f) => /^https:\/\//i.test(f.url || ""));
  const activeDl = book ? downloads.find((d) => d.id === book.id) : null;

  const pos = seek != null ? seek : progress.position;
  // duration is 0 while the track's metadata is still being read (big m4b files
  // and streams take a beat). Guard against NaN/Infinity too.
  const durationKnown = Number.isFinite(progress.duration) && progress.duration > 0;
  const chapterIdx = chapters ? chapterIndexAt(chapters, pos) : -1;
  const chapter = chapters ? chapters[chapterIdx] : null;
  const chapterLeft = chapters && durationKnown ? Math.max(0, chapterEnd(chapters, chapterIdx, progress.duration) - pos) : null;
  const estimate = audiobookEstimate(
    { files, progress: entry && entry.progress },
    { trackIndex: activeIdx, positionSeconds: pos, durationSeconds: progress.duration },
  );
  // In a 20-hour single file one pixel of slider is minutes of audio, so with
  // chapters the slider scrubs the current chapter (switchable to the whole
  // file/part, remembered).
  const scope = chapters && durationKnown && settings.scrubScope !== "book" ? "chapter" : "book";
  const rangeStart = scope === "chapter" ? chapters[chapterIdx].start : 0;
  const rangeEnd = scope === "chapter" ? chapterEnd(chapters, chapterIdx, progress.duration) : progress.duration;
  const nextChapter = chapters ? chapters[chapterIdx + 1] : null;
  const hasPrev = !!chapters || files.length > 1;
  const hasNext = (chapters && nextChapterTarget(chapters, pos) != null) || activeIdx < files.length - 1;

  // "DUNGEON CRAWLER CARL · BOOK 2" above the title (server 3.1+).
  const [seriesLabel, setSeriesLabel] = useState(null);
  useEffect(() => {
    if (!bookId) return undefined;
    let alive = true;
    seriesOf(bookId).then((s) => { if (alive) setSeriesLabel(s ? `${s.name} · Book ${s.position}` : null); }).catch(() => {});
    return () => { alive = false; };
  }, [bookId]);

  // A mistaken chapter tap or scrub otherwise loses your place in a long book:
  // big jumps offer a way back. A burst of jumps goes back to before the first.
  const spot = useRef({ trackIndex: 0, position: 0 });
  useEffect(() => { spot.current = { trackIndex: activeIdx, position: progress.position }; });
  const [undo, setUndo] = useState(null); // { trackIndex, position } to return to
  const undoTimer = useRef(null);
  useEffect(() => () => clearTimeout(undoTimer.current), []);
  const noteJump = useCallback((toIndex, toPosition) => {
    const from = spot.current;
    if (from.trackIndex === toIndex && Math.abs(toPosition - from.position) < UNDO_MIN_SECONDS) return;
    clearTimeout(undoTimer.current);
    setUndo((current) => current || from);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_SHOW_MS);
  }, []);

  async function undoJump() {
    const target = undo;
    clearTimeout(undoTimer.current);
    setUndo(null);
    if (!target) return;
    try {
      if (target.trackIndex !== activeIdx) await skipToIndex(target.trackIndex);
      await seekTo(target.position);
    } catch (_) {}
  }

  // At the end of a book: rate it, and see what's next on your Want to Listen.
  const ended = snapshot.status === "ended";
  // The next book in this one's series comes first; otherwise the top of
  // Want to Listen.
  const [upNext, setUpNext] = useState(null); // { label, open } for the button
  useEffect(() => {
    if (!ended || !bookId) return undefined;
    let alive = true;
    (async () => {
      const books = await listBooks().catch(() => []);
      const series = await seriesOf(bookId).catch(() => null);
      const next = series && series.next && !series.next.upcoming ? series.next : null;
      if (next) {
        const owned = ownedCopy(next, books.filter((b) => b.id !== bookId));
        if (alive) {
          setUpNext({
            label: `Next in series: #${next.position} ${next.title}`,
            open: () => (owned ? nav.navigate("book", { item: owned }) : nav.navigate("search", { query: next.search || next.title })),
          });
        }
        return;
      }
      const saved = wantToListen(books).find((b) => b.id !== bookId);
      if (alive) setUpNext(saved ? { label: `Up next: ${saved.title}`, open: () => nav.navigate("book", { item: saved }) } : null);
    })();
    return () => { alive = false; };
    // nav is the same object for the life of this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended, bookId]);

  async function rateBook(stars) {
    if (!book) return;
    const updated = await setRating(book.id, stars);
    if (updated) setEntry(updated);
  }

  // "Go to time": a timestamp in the current part (the whole book for one file).
  function goToTime() {
    const target = parseTime(gotoText);
    if (target == null) { setGotoError("Type a time like 1:23:45, 23:45 or 90 (minutes)."); return; }
    if (!durationKnown || target > progress.duration) { setGotoError(`That's past the end (${formatTime(progress.duration)}).`); return; }
    setSheet(null);
    noteJump(activeIdx, target);
    seekTo(target).catch(() => {});
  }

  async function dropBookmark() {
    if (!book) return;
    let p = { position: 0 };
    try { p = await TrackPlayer.getProgress(); } catch (_) {}
    await addBookmark(book, { position: p.position || 0, trackIndex: activeIdx, createdAt: Date.now() });
    setEntry(await getBook(book.id));
    setBmFlash(true);
    setTimeout(() => setBmFlash(false), 1500);
  }

  async function goToBookmark(bm) {
    noteJump(bm.trackIndex || 0, bm.position || 0);
    try {
      if ((bm.trackIndex || 0) !== activeIdx) await skipToIndex(bm.trackIndex || 0);
      await seekTo(bm.position || 0);
      await play();
    } catch (_) {}
  }

  async function deleteBookmark(bm) {
    if (!book) return;
    await removeBookmark(book.id, bm.createdAt);
    setEntry(await getBook(book.id));
  }

  function editNote(bm) {
    setEditing({ bookmark: bm, text: bm.note || "" });
    setSheet("note");
  }

  async function saveNote(text = editing ? editing.text : "") {
    if (!book || !editing) return;
    await setBookmarkNote(book.id, editing.bookmark.createdAt, text);
    setEntry(await getBook(book.id));
    setSheet(null);
    setEditing(null);
  }

  function downloadThis() {
    if (!book || !isStreamable) return;
    const dlFiles = files.map((f) => ({ title: f.title, url: f.url, filename: f.filename, size: f.size }));
    downloadWithSpaceCheck({ id: book.id, title: book.title, author: book.author, poster: book.poster }, dlFiles).catch(() => {});
  }

  // Previous/next move by embedded chapter when the part has them, else by part.
  async function step(to) {
    if (!to) return;
    noteJump(to.trackIndex, to.position);
    await (to.trackIndex !== activeIdx ? skipToIndex(to.trackIndex) : seekTo(to.position));
  }
  const previous = () => step(previousStep(chapters, progress.position, activeIdx));
  const next = () => step(nextStep(chapters, progress.position, activeIdx, files.length));

  // Stable handlers keep the memoised chapter/part lists from re-rendering
  // on every progress tick.
  const jumpToChapter = useCallback((c) => {
    setSheet(null);
    noteJump(spot.current.trackIndex, c.start);
    seekTo(c.start).then(play).catch(() => {});
  }, [noteJump]);

  const jumpToPart = useCallback((i) => {
    setSheet(null);
    noteJump(i, 0);
    skipToIndex(i).then(play).catch(() => {});
  }, [noteJump]);

  // A chapter-end timer is wall-clock time to the chapter's end at the current
  // speed, so it is re-aimed whenever the speed changes.
  function sleepAtChapterEnd(atRate = rate) {
    if (chapters && durationKnown) {
      const left = Math.max(1, chapterEnd(chapters, chapterIdx, progress.duration) - progress.position);
      return setSleep(left / atRate / 60, { reason: "chapter" });
    }
    return setSleep("eot");
  }

  // The chosen speed also becomes the default for future books.
  async function changeSpeed(value) {
    const nextRate = roundSpeed(value);
    await setRate(nextRate);
    setSetting("speed", nextRate);
    if (sleep.mode === "timer" && sleep.reason === "chapter") sleepAtChapterEnd(nextRate);
  }

  function startSleep(minutes) {
    setSleep(minutes, settings.sleepFade ? { fadeOutSeconds: SLEEP_FADE_SECONDS } : undefined);
    setSheet(null);
  }

  function extendSleep(minutes) {
    if (sleep.mode !== "timer") return;
    const left = Math.max(0, sleep.endsAt - now) / 60000;
    setSleep(left + minutes, sleep.fadeOutSeconds ? { fadeOutSeconds: sleep.fadeOutSeconds } : undefined);
  }

  const sleepLeft = sleep.mode === "timer" ? Math.max(0, (sleep.endsAt - now) / 1000) : 0;
  const endLabel = chapters ? "end of chapter" : files.length > 1 ? "end of part" : "end of book";
  function sleepLabel() {
    if (sleep.mode === "end-of-track") return `Sleep: ${files.length > 1 ? "end of part" : "end of book"}`;
    if (sleep.mode === "timer") return sleep.reason === "chapter" ? `Sleep: chapter end · ${formatTime(sleepLeft)}` : `Sleep ${formatTime(sleepLeft)}`;
    return "Sleep";
  }

  const subtitle = chapter ? chapter.title : files.length > 1 ? `Part ${activeIdx + 1} of ${files.length}` : (book && book.author) || "";
  const canBrowse = !!chapters || files.length > 1;
  const leftLine = chapter && chapterLeft != null
    ? `Ch ${chapterIdx + 1}/${chapters.length} · ${formatDuration(chapterLeft / rate)} left`
    : files.length > 1 ? `Part ${activeIdx + 1}/${files.length}` : "";
  const rightLine = estimate.remainingSeconds != null && durationKnown
    ? `${estimate.estimated ? "~" : ""}${formatDuration(estimate.remainingSeconds / rate)} left in book`
    : "";

  return (
    <View style={[styles.wrap, { paddingTop: topPad }]}>
      <CoverBackdrop uri={book && book.poster} />
      <View style={styles.header}>
        <TouchableOpacity onPress={nav.goBack} style={styles.headerBtn} accessibilityLabel="Close player" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ChevronIcon dir="down" size={20} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>NOW PLAYING</Text>
        <TouchableOpacity onPress={() => setMenu(true)} style={styles.headerBtn} accessibilityLabel="More" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} disabled={!book}>
          <DotsIcon size={18} color={theme.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View style={styles.art}>
          <View style={styles.artShadow}>
            <CoverArt uri={book && book.poster} size={coverSize} radius={16} />
          </View>
        </View>

        {seriesLabel ? <Text style={styles.seriesKicker} numberOfLines={1}>{seriesLabel}</Text> : null}
        <Text style={[styles.title, seriesLabel && { marginTop: 4 }]} numberOfLines={2}>{(book && book.title) || (track && track.title) || ""}</Text>
        {canBrowse ? (
          <TouchableOpacity style={styles.partBtn} onPress={() => { setChapterFilter(""); setSheet("chapters"); }}>
            <Text style={styles.sub} numberOfLines={1}>{subtitle}</Text>
            <ChevronIcon dir="down" size={13} color={theme.sub} />
          </TouchableOpacity>
        ) : (
          <Text style={styles.sub} numberOfLines={1}>{subtitle}</Text>
        )}

        {snapshot.status === "ended" ? (
          <View style={[styles.banner, styles.endBanner]}>
            <Text style={[styles.bannerTxt, styles.endTitle]}>You finished this book 🎉</Text>
            <Stars value={(entry && entry.rating) || 0} onChange={rateBook} size={28} />
            <View style={styles.endActions}>
              <TouchableOpacity style={styles.bannerBtn} onPress={() => skipToIndex(0).then(() => seekTo(0)).then(play).catch(() => {})}>
                <Text style={styles.bannerBtnTxt}>Listen again</Text>
              </TouchableOpacity>
              {upNext ? (
                <TouchableOpacity style={styles.upNextBtn} onPress={upNext.open} accessibilityLabel={upNext.label}>
                  <Text style={styles.upNextTxt} numberOfLines={1}>{upNext.label} ›</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : snapshot.status === "reconnecting" ? (
          <View style={styles.banner}>
            <ActivityIndicator color={theme.accent} size="small" />
            <Text style={styles.bannerTxt}>Refreshing the stream link…</Text>
          </View>
        ) : snapshot.status === "error" ? (
          <View style={styles.banner}>
            <Text style={[styles.bannerTxt, { color: theme.danger }]} numberOfLines={2}>
              {(snapshot.error && snapshot.error.message) || "Playback stopped"}
            </Text>
            <TouchableOpacity style={styles.bannerBtn} onPress={() => retryPlayback().catch(() => {})}>
              <Text style={styles.bannerBtnTxt}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Until the track's metadata is parsed, duration is 0. Falling back to
            a max of 1 there pegged the bar at 100% and showed "35:03:21 / 0:00";
            treat unknown duration as an explicit loading state instead, and
            clamp position so a stale/overshooting seek can't fill the bar. */}
        {chapters && durationKnown ? (
          <View style={styles.scopeRow}>
            {[["chapter", "Chapter"], ["book", files.length > 1 ? "Whole part" : "Whole book"]].map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[styles.scopeBtn, scope === key && styles.scopeBtnActive]}
                onPress={() => setSetting("scrubScope", key)}
                accessibilityRole="button"
                accessibilityState={{ selected: scope === key }}
              >
                <Text style={[styles.scopeTxt, scope === key && styles.scopeTxtActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        <Slider
          style={{ width: "100%", height: 40, marginTop: chapters && durationKnown ? 4 : 14 }}
          minimumValue={durationKnown ? rangeStart : 0}
          maximumValue={durationKnown ? rangeEnd : 1}
          value={durationKnown ? Math.min(Math.max(pos, rangeStart), rangeEnd) : 0}
          disabled={!durationKnown}
          minimumTrackTintColor={durationKnown ? theme.accent : theme.border}
          maximumTrackTintColor={theme.border}
          thumbTintColor={durationKnown ? theme.accent : "transparent"}
          onSlidingStart={() => setSeek(progress.position)}
          onValueChange={(v) => setSeek(v)}
          onSlidingComplete={async (v) => { noteJump(activeIdx, v); await seekTo(v); setSeek(null); }}
        />
        <View style={styles.times}>
          <TouchableOpacity
            onPress={() => { setGotoText(""); setGotoError(null); setSheet("goto"); }}
            disabled={!durationKnown}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            accessibilityLabel="Go to a time"
          >
            <Text style={styles.time}>{durationKnown ? formatTime(Math.max(0, pos - rangeStart)) : "—:—"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setSetting("showRemaining", !settings.showRemaining)}
            disabled={!durationKnown}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            accessibilityLabel={settings.showRemaining ? "Show length" : "Show time left"}
          >
            <Text style={styles.time}>
              {!durationKnown ? "Loading…" : settings.showRemaining ? `-${formatTime(Math.max(0, rangeEnd - pos))}` : formatTime(rangeEnd - rangeStart)}
            </Text>
          </TouchableOpacity>
        </View>
        {(leftLine || rightLine) ? (
          <View style={styles.times}>
            <Text style={styles.timeSub}>{leftLine}</Text>
            <Text style={styles.timeSub}>{rightLine}</Text>
          </View>
        ) : null}
        {nextChapter ? (
          <Text style={styles.upNext} numberOfLines={1}>Up next · {nextChapter.title}</Text>
        ) : null}

        <View style={styles.controls}>
          <TouchableOpacity style={[styles.ctrl, !hasPrev && styles.ctrlOff]} disabled={!hasPrev} onPress={() => previous().catch(() => {})} accessibilityLabel={chapters ? "Previous chapter" : "Previous part"}>
            <SkipIcon dir="prev" size={24} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ctrl}
            onPress={() => seekBy(-settings.jumpBack).catch(() => {})}
            accessibilityLabel={`Back ${settings.jumpBack} seconds`}
          >
            <JumpIcon dir="back" seconds={settings.jumpBack} size={40} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => (playing ? pause() : play())}
            onLongPress={dropBookmark}
            accessibilityLabel={playing ? "Pause" : "Play"}
          >
            <LinearGradient colors={theme.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.play}>
              <PlayPauseIcon playing={playing} size={30} />
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ctrl}
            onPress={() => seekBy(settings.jumpForward).catch(() => {})}
            accessibilityLabel={`Forward ${settings.jumpForward} seconds`}
          >
            <JumpIcon dir="forward" seconds={settings.jumpForward} size={40} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.ctrl, !hasNext && styles.ctrlOff]} disabled={!hasNext} onPress={() => next().catch(() => {})} accessibilityLabel={chapters ? "Next chapter" : "Next part"}>
            <SkipIcon dir="next" size={24} color={theme.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.extras}>
          <TouchableOpacity style={styles.chip} onPress={() => setSheet("speed")}>
            <Text style={styles.chipTxt}>{formatSpeed(rate)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, bmFlash && styles.chipActive]} onPress={dropBookmark}>
            <Text style={styles.chipTxt}>{bmFlash ? "Bookmarked ✓" : "+ Bookmark"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, sleep.mode !== "off" && styles.chipActive]} onPress={() => setSheet("sleep")}>
            <Text style={styles.chipTxt}>{sleepLabel()}</Text>
          </TouchableOpacity>
          {downloaded ? (
            <View style={[styles.chip, styles.chipDone, styles.chipRow]}>
              <CheckIcon size={12} color={theme.good} />
              <Text style={styles.chipTxt}>Downloaded</Text>
            </View>
          ) : activeDl && activeDl.status !== "error" ? (
            <View style={styles.chip}>
              <Text style={styles.chipTxt}>Downloading {activeDl.pct}%</Text>
            </View>
          ) : isStreamable ? (
            <TouchableOpacity style={[styles.chip, styles.chipRow]} onPress={downloadThis}>
              <DownloadIcon size={13} color={theme.text} />
              <Text style={styles.chipTxt}>Download</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {bookmarks.length > 0 && (
          <View style={styles.chapters}>
            <View style={styles.headRow}>
              <Text style={styles.chaptersHead}>Bookmarks</Text>
              <TouchableOpacity
                onPress={() => Share.share({ title: book.title, message: bookmarksText({ ...book, bookmarks }) }).catch(() => {})}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Share these bookmarks"
              >
                <Text style={styles.bmEdit}>Share</Text>
              </TouchableOpacity>
            </View>
            {bookmarks.map((bm) => (
              <TouchableOpacity key={bm.createdAt} style={styles.chapter} onPress={() => goToBookmark(bm)} onLongPress={() => editNote(bm)}>
                <Text style={styles.chapterNum}>{files.length > 1 ? (bm.trackIndex || 0) + 1 : "•"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.chapterTitle} numberOfLines={1}>
                    {files.length > 1 ? `Part ${(bm.trackIndex || 0) + 1} · ` : ""}{formatTime(bm.position)}
                    {chapters && (bm.trackIndex || 0) === activeIdx ? ` · ${chapters[chapterIndexAt(chapters, bm.position || 0)].title}` : ""}
                  </Text>
                  {bm.note ? <Text style={styles.bmNote} numberOfLines={2}>{bm.note}</Text> : null}
                </View>
                <TouchableOpacity onPress={() => editNote(bm)} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} accessibilityLabel="Edit note">
                  <Text style={styles.bmEdit}>{bm.note ? "Edit" : "Note"}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteBookmark(bm)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <CloseIcon size={12} color={theme.dim} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {chapters && (
          <View style={styles.chapters}>
            <Text style={styles.chaptersHead}>{files.length > 1 ? `Chapters · part ${activeIdx + 1}` : "Chapters"}</Text>
            <ChapterRows chapters={chapters} activeIndex={chapterIdx} playing={playing} total={durationKnown ? progress.duration : 0} onPick={jumpToChapter} />
          </View>
        )}

        {files.length > 1 && (
          <View style={styles.chapters}>
            <Text style={styles.chaptersHead}>{chapters ? "Parts" : "Chapters"}</Text>
            <PartRows files={files} activeIndex={activeIdx} playing={playing} onPick={jumpToPart} />
          </View>
        )}
      </ScrollView>

      {undo ? (
        <TouchableOpacity
          style={styles.undo}
          onPress={undoJump}
          accessibilityRole="button"
          accessibilityLabel={`Undo jump: back to ${formatTime(undo.position)}${undo.trackIndex !== activeIdx ? ` in part ${undo.trackIndex + 1}` : ""}`}
        >
          <Text style={styles.undoTxt}>
            ↶ Back to {undo.trackIndex !== activeIdx ? `part ${undo.trackIndex + 1} · ` : ""}{formatTime(undo.position)}
          </Text>
        </TouchableOpacity>
      ) : null}

      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        title={book ? book.title : ""}
        actions={book ? [
          { label: "Car mode", hint: "Big buttons for driving", onPress: () => nav.navigate("car") },
          { label: "Book details", onPress: () => nav.navigate("book", { item: entry || book }) },
          { label: "All bookmarks", hint: "Every book's bookmarks and notes", onPress: () => nav.navigate("bookmarks") },
          {
            label: "Mark as finished",
            hint: "Closes the book and moves it to Finished",
            onPress: async () => { const id = book.id; await closeBook().catch(() => {}); await setFinished(id, true); nav.goBack(); },
          },
          {
            label: "Close book",
            hint: "Stops playback; your place is saved",
            destructive: true,
            onPress: async () => { await closeBook().catch(() => {}); nav.goBack(); },
          },
        ] : []}
      />

      <Sheet visible={sheet === "chapters"} onClose={() => setSheet(null)} title={chapters ? "Chapters" : "Parts"}>
        {(chapters ? chapters.length : files.length) > SEARCHABLE_LIST ? (
          <TextInput
            style={styles.findInput}
            value={chapterFilter}
            onChangeText={setChapterFilter}
            placeholder={chapters ? "Find a chapter" : "Find a part"}
            placeholderTextColor={theme.dim}
            autoCorrect={false}
          />
        ) : null}
        {chapters
          ? <ChapterRows chapters={chapters} activeIndex={chapterIdx} playing={playing} total={durationKnown ? progress.duration : 0} onPick={jumpToChapter} filter={chapterFilter} />
          : <PartRows files={files} activeIndex={activeIdx} playing={playing} onPick={jumpToPart} filter={chapterFilter} />}
      </Sheet>

      <Sheet visible={sheet === "goto"} onClose={() => setSheet(null)} title="Go to time">
        <TextInput
          style={styles.findInput}
          value={gotoText}
          onChangeText={(text) => { setGotoText(text); setGotoError(null); }}
          onSubmitEditing={goToTime}
          placeholder="1:23:45"
          placeholderTextColor={theme.dim}
          keyboardType="numbers-and-punctuation"
          returnKeyType="go"
          autoFocus
        />
        <Text style={[styles.sheetNote, gotoError && { color: theme.danger }]}>
          {gotoError || `A time in ${files.length > 1 ? `part ${activeIdx + 1}` : "the book"}, up to ${formatTime(progress.duration)}. A plain number is minutes.`}
        </Text>
        <View style={styles.presetGrid}>
          <TouchableOpacity style={[styles.preset, styles.presetActive]} onPress={goToTime}>
            <Text style={[styles.presetTxt, styles.presetTxtActive]}>Go</Text>
          </TouchableOpacity>
        </View>
      </Sheet>

      <Sheet visible={sheet === "note"} onClose={() => { setSheet(null); setEditing(null); }} title="Bookmark note">
        <TextInput
          style={styles.noteInput}
          value={editing ? editing.text : ""}
          onChangeText={(text) => setEditing((e) => (e ? { ...e, text } : e))}
          placeholder="What's worth remembering here?"
          placeholderTextColor={theme.dim}
          multiline
          maxLength={500}
          autoFocus
        />
        <View style={styles.presetGrid}>
          <TouchableOpacity style={[styles.preset, styles.presetActive]} onPress={() => saveNote()}>
            <Text style={[styles.presetTxt, styles.presetTxtActive]}>Save</Text>
          </TouchableOpacity>
          {editing && editing.bookmark.note ? (
            <TouchableOpacity style={styles.preset} onPress={() => saveNote("")}>
              <Text style={[styles.presetTxt, { color: theme.danger }]}>Remove note</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </Sheet>

      <Sheet visible={sheet === "speed"} onClose={() => setSheet(null)} title="Playback speed">
        <View style={styles.speedRow}>
          <TouchableOpacity style={styles.stepBtn} onPress={() => changeSpeed(rate - 0.05)} accessibilityLabel="Slower">
            <Text style={styles.stepTxt}>−</Text>
          </TouchableOpacity>
          <Text style={styles.speedBig}>{formatSpeed(rate)}</Text>
          <TouchableOpacity style={styles.stepBtn} onPress={() => changeSpeed(rate + 0.05)} accessibilityLabel="Faster">
            <Text style={styles.stepTxt}>+</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.presetGrid}>
          {SPEED_PRESETS.map((v) => {
            const active = Math.abs(v - rate) < 0.001;
            return (
              <TouchableOpacity key={v} style={[styles.preset, active && styles.presetActive]} onPress={() => changeSpeed(v)}>
                <Text style={[styles.presetTxt, active && styles.presetTxtActive]}>{formatSpeed(v)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.sheetNote}>This book remembers its speed, and books you start next begin at it too.</Text>
      </Sheet>

      <Sheet visible={sheet === "sleep"} onClose={() => setSheet(null)} title="Sleep timer">
        {sleep.mode !== "off" && (
          <View style={styles.sleepNow}>
            <Text style={styles.sleepBig}>
              {sleep.mode === "timer" ? formatTime(sleepLeft) : `At the ${files.length > 1 ? "end of this part" : "end of the book"}`}
            </Text>
            <Text style={styles.sheetNote}>
              {sleep.mode === "timer" && sleep.reason === "chapter" ? "Pausing when this chapter ends" : "Until playback pauses"}
              {sleep.mode === "timer" && sleep.fadeOutSeconds ? " · fades out" : ""}
            </Text>
            <View style={styles.presetGrid}>
              {sleep.mode === "timer" && sleep.reason !== "chapter" && [5, 15].map((m) => (
                <TouchableOpacity key={m} style={styles.preset} onPress={() => extendSleep(m)}>
                  <Text style={styles.presetTxt}>+{m} min</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.preset} onPress={() => { setSleep(0); setSheet(null); }}>
                <Text style={[styles.presetTxt, { color: theme.danger }]}>Turn off</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        <View style={styles.presetGrid}>
          {SLEEP_MINUTES.map((m) => (
            <TouchableOpacity key={m} style={styles.preset} onPress={() => startSleep(m)}>
              <Text style={styles.presetTxt}>{m < 60 ? `${m} min` : `${m / 60 === 1 ? "1 hour" : `${m / 60} hours`}`}</Text>
            </TouchableOpacity>
          ))}
          {(chapters || files.length > 1) && (
            <TouchableOpacity style={styles.preset} onPress={() => { sleepAtChapterEnd(); setSheet(null); }}>
              <Text style={styles.presetTxt}>{endLabel[0].toUpperCase() + endLabel.slice(1)}</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>Fade out</Text>
            <Text style={styles.sheetNote}>Lower the volume over the last {SLEEP_FADE_SECONDS} seconds of a timer</Text>
          </View>
          <Switch
            value={!!settings.sleepFade}
            onValueChange={(v) => setSetting("sleepFade", v)}
            trackColor={{ false: theme.border, true: theme.accent2 }}
            thumbColor={settings.sleepFade ? theme.accent : theme.sub}
          />
        </View>
      </Sheet>
    </View>
  );
}

// Memoised: the player re-renders every second for the clock, and rebuilding
// a 150-row part list each time made long books visibly sluggish.
// Each chapter shows its length; the one playing shows how far into it you are.
const ChapterRows = memo(function ChapterRows({ chapters, activeIndex, playing, total, onPick, filter }) {
  const needle = (filter || "").trim().toLowerCase();
  return chapters.map((c, i) => {
    if (needle && !`${i + 1} ${c.title}`.toLowerCase().includes(needle)) return null;
    const active = i === activeIndex;
    const length = Math.max(0, chapterEnd(chapters, i, total) - c.start);
    return (
      <TouchableOpacity key={`${i}:${c.start}`} style={[styles.chapter, active && styles.chapterActive]} onPress={() => onPick(c)}>
        <Text style={[styles.chapterNum, active && { color: theme.accent }]}>{i + 1}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.chapterTitle, active && { color: theme.accent }]} numberOfLines={1}>{c.title}</Text>
          {active && length > 0 ? <ChapterProgress start={c.start} length={length} /> : null}
        </View>
        {active
          ? <PlayPauseIcon playing={playing} size={11} color={theme.accent} />
          : <Text style={styles.chapterTime}>{length > 0 ? formatDuration(length) : formatTime(c.start)}</Text>}
      </TouchableOpacity>
    );
  });
});

// Its own component so only this bar re-renders as the position moves.
function ChapterProgress({ start, length }) {
  const { position } = useProgress();
  const pct = Math.min(100, Math.max(0, ((position - start) / length) * 100));
  return <View style={styles.chTrack}><View style={[styles.chFill, { width: `${pct}%` }]} /></View>;
}

const PartRows = memo(function PartRows({ files, activeIndex, playing, onPick, filter }) {
  const needle = (filter || "").trim().toLowerCase();
  return files.map((f, i) => {
    if (needle && !`${i + 1} ${f.title || ""}`.toLowerCase().includes(needle)) return null;
    const active = i === activeIndex;
    return (
      <TouchableOpacity key={i} style={[styles.chapter, active && styles.chapterActive]} onPress={() => onPick(i)}>
        <Text style={[styles.chapterNum, active && { color: theme.accent }]}>{i + 1}</Text>
        <Text style={[styles.chapterTitle, active && { color: theme.accent }]} numberOfLines={1}>
          {f.title || `Part ${i + 1}`}
        </Text>
        {active && <PlayPauseIcon playing={playing} size={11} color={theme.accent} />}
      </TouchableOpacity>
    );
  });
});

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 24 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  headerBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: "#ffffff14" },
  headerTitle: { color: theme.sub, fontSize: 12, fontWeight: "700", letterSpacing: 1.5 },
  scopeRow: { flexDirection: "row", alignSelf: "center", backgroundColor: "#ffffff10", borderRadius: 14, padding: 3, marginTop: 14 },
  scopeBtn: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 11 },
  scopeBtnActive: { backgroundColor: "#ffffff22" },
  scopeTxt: { color: theme.dim, fontSize: 12, fontWeight: "600" },
  scopeTxtActive: { color: theme.text },
  upNext: { color: theme.dim, fontSize: 12, textAlign: "center", marginTop: 8 },
  undo: {
    position: "absolute", bottom: 24, alignSelf: "center", flexDirection: "row", alignItems: "center",
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.accent, borderRadius: 22,
    paddingHorizontal: 18, paddingVertical: 11, elevation: 8, shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8,
  },
  undoTxt: { color: theme.text, fontWeight: "700", fontVariant: ["tabular-nums"] },
  art: { alignItems: "center", marginTop: 18 },
  artShadow: {
    borderRadius: 16, elevation: 14, shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 16,
    backgroundColor: theme.card,
  },
  title: { color: theme.text, fontSize: 20, fontWeight: "700", textAlign: "center", marginTop: 24 },
  seriesKicker: { color: theme.accent, fontSize: 12, fontWeight: "800", letterSpacing: 1, textAlign: "center", textTransform: "uppercase", marginTop: 22 },
  sub: { color: theme.sub, textAlign: "center", marginTop: 6, flexShrink: 1 },
  partBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 2, paddingHorizontal: 12 },
  banner: {
    flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14, padding: 10,
    backgroundColor: "#00000040", borderWidth: 1, borderColor: "#ffffff1f", borderRadius: 10,
  },
  bannerTxt: { color: theme.text, flex: 1, fontSize: 13 },
  bannerBtn: { backgroundColor: theme.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  bannerBtnTxt: { color: "#fff", fontWeight: "700" },
  endBanner: { flexDirection: "column", alignItems: "center", gap: 12, paddingVertical: 14 },
  endTitle: { flex: 0, fontSize: 15, fontWeight: "700" },
  endActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  upNextBtn: { borderWidth: 1, borderColor: theme.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, maxWidth: 260 },
  upNextTxt: { color: theme.text, fontWeight: "600" },
  times: { flexDirection: "row", justifyContent: "space-between", marginTop: -6 },
  time: { color: theme.dim, fontSize: 12 },
  timeSub: { color: theme.sub, fontSize: 12, marginTop: 10 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22 },
  ctrl: { padding: 8 },
  ctrlOff: { opacity: 0.3 },
  play: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" },
  extras: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 10, marginTop: 26 },
  chip: { backgroundColor: "#ffffff12", borderWidth: 1, borderColor: "#ffffff1f", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  chipRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  chipActive: { borderColor: theme.accent },
  chipDone: { borderColor: theme.good + "55" },
  chipTxt: { color: theme.text, fontWeight: "600", fontVariant: ["tabular-nums"] },
  chapters: { marginTop: 28 },
  chaptersHead: { color: theme.sub, fontWeight: "700", fontSize: 13, textTransform: "uppercase", marginBottom: 6 },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  chapter: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, marginBottom: 2,
  },
  chapterActive: { backgroundColor: theme.card },
  chapterNum: { color: theme.dim, fontSize: 13, width: 24, textAlign: "right", fontVariant: ["tabular-nums"] },
  chapterTitle: { color: theme.text, flex: 1 },
  chTrack: { height: 3, borderRadius: 2, backgroundColor: theme.border, marginTop: 6 },
  chFill: { height: 3, borderRadius: 2, backgroundColor: theme.accent },
  chapterTime: { color: theme.dim, fontSize: 12, fontVariant: ["tabular-nums"] },
  bmNote: { color: theme.sub, fontSize: 12, marginTop: 2 },
  bmEdit: { color: theme.accent, fontSize: 12, fontWeight: "600" },
  findInput: {
    color: theme.text, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 10,
    paddingHorizontal: 12, height: 44, marginHorizontal: 4, marginBottom: 8,
  },
  noteInput: {
    color: theme.text, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 10,
    padding: 12, minHeight: 90, textAlignVertical: "top", marginHorizontal: 4, marginBottom: 8,
  },
  speedRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 28, marginVertical: 10 },
  stepBtn: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" },
  stepTxt: { color: theme.text, fontSize: 26, fontWeight: "600", marginTop: -2 },
  speedBig: { color: theme.text, fontSize: 34, fontWeight: "800", minWidth: 110, textAlign: "center", fontVariant: ["tabular-nums"] },
  presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 4, marginTop: 6 },
  preset: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9 },
  presetActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  presetTxt: { color: theme.text, fontWeight: "600" },
  presetTxtActive: { color: "#fff" },
  sheetNote: { color: theme.dim, fontSize: 12, marginTop: 6, paddingHorizontal: 4 },
  sleepNow: { alignItems: "center", paddingBottom: 14, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.border },
  sleepBig: { color: theme.text, fontSize: 30, fontWeight: "800", fontVariant: ["tabular-nums"] },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 4, paddingTop: 16 },
  switchLabel: { color: theme.text, fontWeight: "600" },
});
