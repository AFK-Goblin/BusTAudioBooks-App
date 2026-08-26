import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal } from "react-native";
import Slider from "@react-native-community/slider";
import TrackPlayer, { useProgress, useIsPlaying, useActiveMediaItem } from "@rntp/player";
import { theme } from "../src/theme";
import { formatTime } from "../src/format";
import { getCurrentBook, setRate, getRate, getSleep, setSleep, subscribeSleep, play, pause, seekTo, seekBy, skipBy, skipToIndex } from "../src/player";
import { Backdrop, CoverArt, PlayPauseIcon } from "../src/ui";
import { ChevronIcon, SkipIcon, JumpIcon, DownloadIcon, CheckIcon, CloseIcon } from "../src/icons";
import { LinearGradient } from "expo-linear-gradient";
import { startDownload } from "../src/downloads";
import { useDownloads } from "../src/downloadStore";
import { getBook, addBookmark, removeBookmark } from "../src/library";
import { useSettings, setSetting, SPEED_OPTIONS } from "../src/settings";
import { useScreenPad } from "../src/layout";

const SLEEP_OPTIONS = [0, 10, 15, 30, 45, 60, "eot"];

export default function PlayerScreen({ nav }) {
  const progress = useProgress();
  const playing = useIsPlaying();
  const track = useActiveMediaItem();
  const book = getCurrentBook();
  const settings = useSettings();
  const topPad = useScreenPad();
  const [seek, setSeek] = useState(null);
  const [speed, setSpeed] = useState(settings.speed || 1);
  const [sleep, setSleepState] = useState(getSleep());
  const [downloaded, setDownloaded] = useState(false);
  const [bookmarks, setBookmarks] = useState([]);
  const [bmFlash, setBmFlash] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const downloads = useDownloads();

  const files = (book && book.files) || [];
  const activeIdx = track && track.extras ? Number(track.extras.trackIndex) || 0 : 0;

  // Show the REAL playback rate, not a per-mount default (it survives
  // leaving and re-entering this screen).
  useEffect(() => {
    (async () => setSpeed(await getRate()))();
  }, []);

  useEffect(() => subscribeSleep(setSleepState), []);

  // Can we download what we're streaming? (Has HTTPS stream URLs, not already local/downloaded.)
  const isStreamable = files.length > 0 && files.every((f) => /^https:\/\//i.test(f.url || ""));
  const activeDl = book ? downloads.find((d) => d.id === book.id) : null;

  useEffect(() => {
    (async () => {
      if (!book) return;
      const b = await getBook(book.id);
      setDownloaded(!!(b && b.downloaded));
      setBookmarks((b && b.bookmarks) || []);
    })();
  }, [book && book.id, downloads.length]);

  async function dropBookmark() {
    if (!book) return;
    let p = { position: 0 };
    try { p = await TrackPlayer.getProgress(); } catch (_) {}
    const bms = await addBookmark(book, { position: p.position || 0, trackIndex: activeIdx, createdAt: Date.now() });
    setBookmarks(bms);
    setBmFlash(true);
    setTimeout(() => setBmFlash(false), 1500);
  }

  async function goToBookmark(bm) {
    try {
      if ((bm.trackIndex || 0) !== activeIdx) await skipToIndex(bm.trackIndex || 0);
      await seekTo(bm.position || 0);
      await play();
    } catch (_) {}
  }

  async function deleteBookmark(bm) {
    if (!book) return;
    setBookmarks(await removeBookmark(book.id, bm.createdAt));
  }

  function downloadThis() {
    if (!book || !isStreamable) return;
    const dlFiles = files.map((f) => ({ title: f.title, url: f.url, filename: f.filename }));
    startDownload({ id: book.id, title: book.title, author: book.author, poster: book.poster }, dlFiles);
  }

  // Cycle speed; the chosen speed also becomes the default for future books.
  async function cycleSpeed() {
    const i = SPEED_OPTIONS.findIndex((v) => Math.abs(v - speed) < 0.01);
    const next = SPEED_OPTIONS[(i + 1) % SPEED_OPTIONS.length];
    setSpeed(next);
    await setRate(next);
    setSetting("speed", next);
  }

  function cycleSleep() {
    // Find current position in the option list (timer minutes aren't stored, so
    // treat any running timer as its nearest option).
    let i = 0;
    if (sleep.mode === "eot") i = SLEEP_OPTIONS.indexOf("eot");
    else if (sleep.mode === "timer") {
      const remaining = Math.ceil((sleep.until - Date.now()) / 60000);
      i = SLEEP_OPTIONS.findIndex((v) => typeof v === "number" && v >= remaining);
      if (i < 0) i = SLEEP_OPTIONS.length - 2;
    }
    setSleep(SLEEP_OPTIONS[(i + 1) % SLEEP_OPTIONS.length]);
  }

  function sleepLabel() {
    if (sleep.mode === "eot") return "Sleep: end of chapter";
    if (sleep.mode === "timer") {
      const m = Math.max(1, Math.ceil((sleep.until - Date.now()) / 60000));
      return `Sleep ${m}m`;
    }
    return "Sleep off";
  }

  const pos = seek != null ? seek : progress.position;
  // duration is 0 while the track's metadata is still being read (big m4b files
  // and streams take a beat). Guard against NaN/Infinity too.
  const durationKnown = Number.isFinite(progress.duration) && progress.duration > 0;

  return (
    <View style={[styles.wrap, { paddingTop: topPad }]}>
      <Backdrop />
      <TouchableOpacity onPress={nav.goBack} style={styles.backRow}>
        <ChevronIcon dir="left" size={18} color={theme.accent} />
        <Text style={styles.back}>Now Playing</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View style={styles.art}>
          <View style={styles.artShadow}>
            <CoverArt uri={book && book.poster} size={230} radius={16} />
          </View>
        </View>

        <Text style={styles.title} numberOfLines={2}>{(book && book.title) || (track && track.title) || ""}</Text>
        {files.length > 1 ? (
          <TouchableOpacity style={styles.partBtn} onPress={() => setShowChapters(true)}>
            <Text style={styles.sub}>Part {activeIdx + 1} of {files.length}</Text>
            <ChevronIcon dir="down" size={13} color={theme.sub} />
          </TouchableOpacity>
        ) : (
          <Text style={styles.sub} numberOfLines={1}>{(book && book.author) || ""}</Text>
        )}

        {/* Until the track's metadata is parsed, duration is 0. Falling back to
            a max of 1 there pegged the bar at 100% and showed "35:03:21 / 0:00";
            treat unknown duration as an explicit loading state instead, and
            clamp position so a stale/overshooting seek can't fill the bar. */}
        <Slider
          style={{ width: "100%", height: 40, marginTop: 14 }}
          minimumValue={0}
          maximumValue={durationKnown ? progress.duration : 1}
          value={durationKnown ? Math.min(Math.max(pos, 0), progress.duration) : 0}
          disabled={!durationKnown}
          minimumTrackTintColor={durationKnown ? theme.accent : theme.border}
          maximumTrackTintColor={theme.border}
          thumbTintColor={durationKnown ? theme.accent : "transparent"}
          onSlidingStart={() => setSeek(progress.position)}
          onValueChange={(v) => setSeek(v)}
          onSlidingComplete={async (v) => { await seekTo(v); setSeek(null); }}
        />
        <View style={styles.times}>
          <Text style={styles.time}>{durationKnown ? formatTime(pos) : "—:—"}</Text>
          <Text style={styles.time}>{durationKnown ? formatTime(progress.duration) : "Loading…"}</Text>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity style={styles.ctrl} onPress={() => skipBy(-1).catch(() => {})}>
            <SkipIcon dir="prev" size={24} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ctrl}
            onPress={() => seekBy(-settings.jumpBack).catch(() => {})}
          >
            <JumpIcon dir="back" seconds={settings.jumpBack} size={40} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => (playing ? pause() : play())}
            onLongPress={dropBookmark}
          >
            <LinearGradient colors={theme.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.play}>
              <PlayPauseIcon playing={playing} size={30} />
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ctrl}
            onPress={() => seekBy(settings.jumpForward).catch(() => {})}
          >
            <JumpIcon dir="forward" seconds={settings.jumpForward} size={40} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.ctrl} onPress={() => skipBy(1).catch(() => {})}>
            <SkipIcon dir="next" size={24} color={theme.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.extras}>
          <TouchableOpacity style={styles.chip} onPress={cycleSpeed}>
            <Text style={styles.chipTxt}>{speed}×</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, bmFlash && styles.chipActive]} onPress={dropBookmark}>
            <Text style={styles.chipTxt}>{bmFlash ? "Bookmarked ✓" : "+ Bookmark"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, sleep.mode !== "off" && styles.chipActive]} onPress={cycleSleep}>
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
            <Text style={styles.chaptersHead}>Bookmarks</Text>
            {bookmarks.map((bm) => (
              <TouchableOpacity key={bm.createdAt} style={styles.chapter} onPress={() => goToBookmark(bm)}>
                <Text style={styles.chapterNum}>{files.length > 1 ? (bm.trackIndex || 0) + 1 : "•"}</Text>
                <Text style={styles.chapterTitle}>
                  {files.length > 1 ? `Part ${(bm.trackIndex || 0) + 1} · ` : ""}{formatTime(bm.position)}
                </Text>
                <TouchableOpacity onPress={() => deleteBookmark(bm)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <CloseIcon size={12} color={theme.dim} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {files.length > 1 && (
          <View style={styles.chapters}>
            <Text style={styles.chaptersHead}>Chapters</Text>
            {files.map((f, i) => {
              const active = i === activeIdx;
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.chapter, active && styles.chapterActive]}
                  onPress={() => { skipToIndex(i).then(play).catch(() => {}); }}
                >
                  <Text style={[styles.chapterNum, active && { color: theme.accent }]}>{i + 1}</Text>
                  <Text style={[styles.chapterTitle, active && { color: theme.accent }]} numberOfLines={1}>
                    {f.title || `Part ${i + 1}`}
                  </Text>
                  {active && <PlayPauseIcon playing={playing} size={11} color={theme.accent} />}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal visible={showChapters} transparent animationType="slide" onRequestClose={() => setShowChapters(false)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setShowChapters(false)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Chapters</Text>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {files.map((f, i) => {
                const active = i === activeIdx;
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.chapter, active && styles.chapterActive]}
                    onPress={() => {
                      setShowChapters(false);
                      skipToIndex(i).then(play).catch(() => {});
                    }}
                  >
                    <Text style={[styles.chapterNum, active && { color: theme.accent }]}>{i + 1}</Text>
                    <Text style={[styles.chapterTitle, active && { color: theme.accent }]} numberOfLines={1}>
                      {f.title || `Part ${i + 1}`}
                    </Text>
                    {active && <PlayPauseIcon playing={playing} size={11} color={theme.accent} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 24 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 },
  back: { color: theme.accent, fontSize: 16 },
  art: { alignItems: "center", marginTop: 18 },
  artShadow: {
    borderRadius: 16, elevation: 14, shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 16,
    backgroundColor: theme.card,
  },
  title: { color: theme.text, fontSize: 20, fontWeight: "700", textAlign: "center", marginTop: 24 },
  sub: { color: theme.sub, textAlign: "center", marginTop: 6 },
  partBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 2 },
  times: { flexDirection: "row", justifyContent: "space-between", marginTop: -6 },
  time: { color: theme.dim, fontSize: 12 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22 },
  ctrl: { padding: 8 },
  play: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" },
  extras: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 10, marginTop: 26 },
  chip: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  chipRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  chipActive: { borderColor: theme.accent },
  chipDone: { borderColor: theme.good + "55" },
  chipTxt: { color: theme.text, fontWeight: "600" },
  chapters: { marginTop: 28 },
  chaptersHead: { color: theme.sub, fontWeight: "700", fontSize: 13, textTransform: "uppercase", marginBottom: 6 },
  chapter: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, marginBottom: 2,
  },
  chapterActive: { backgroundColor: theme.card },
  chapterNum: { color: theme.dim, fontSize: 13, width: 24, textAlign: "right", fontVariant: ["tabular-nums"] },
  chapterTitle: { color: theme.text, flex: 1 },
  sheetBackdrop: { flex: 1, backgroundColor: "#00000088", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.card, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingBottom: 24, paddingTop: 10,
  },
  sheetHandle: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: theme.border, marginBottom: 10 },
  sheetTitle: { color: theme.sub, fontWeight: "700", fontSize: 13, textTransform: "uppercase", marginBottom: 6, marginLeft: 12 },
});
