import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useProgress, useIsPlaying, useActiveMediaItem } from "@rntp/player";
import { LinearGradient } from "expo-linear-gradient";
import { theme } from "../src/theme";
import { formatDuration } from "../src/format";
import { usePlaybackSnapshot, play, pause, seekBy, seekTo, skipToIndex } from "../src/player";
import { addBookmark } from "../src/library";
import { useSettings } from "../src/settings";
import { useScreenPad } from "../src/layout";
import { useEmbeddedChapters } from "../src/chapters/useEmbeddedChapters";
import { chapterIndexAt, chapterEnd, previousStep, nextStep } from "../src/chapters/navigation";
import { PlayPauseIcon } from "../src/ui";
import { ChevronIcon, JumpIcon, SkipIcon } from "../src/icons";

// Car mode: only the controls you need while driving, each big enough to hit
// without looking twice.
export default function CarScreen({ nav }) {
  const progress = useProgress();
  const playing = useIsPlaying();
  const track = useActiveMediaItem();
  const snapshot = usePlaybackSnapshot();
  const settings = useSettings();
  const topPad = useScreenPad();
  const [marked, setMarked] = useState(false);
  const markTimer = useRef(null);
  useEffect(() => () => clearTimeout(markTimer.current), []);

  const book = snapshot.book;
  const files = (book && book.files) || [];
  const activeIdx = track && track.extras ? Number(track.extras.trackIndex) || 0 : snapshot.activeTrackIndex || 0;
  const chapters = useEmbeddedChapters(book, activeIdx);
  const pos = progress.position;
  const durationKnown = Number.isFinite(progress.duration) && progress.duration > 0;
  const chapterIdx = chapters ? chapterIndexAt(chapters, pos) : -1;
  const chapter = chapters ? chapters[chapterIdx] : null;
  const end = chapter && durationKnown ? chapterEnd(chapters, chapterIdx, progress.duration) : progress.duration;
  const left = durationKnown ? Math.max(0, end - pos) / (snapshot.rate || 1) : null;
  const unit = chapters ? "chapter" : "part";
  const where = chapter ? chapter.title : files.length > 1 ? `Part ${activeIdx + 1} of ${files.length}` : (book && book.author) || "";
  const forward = nextStep(chapters, pos, activeIdx, files.length);

  async function go(to) {
    if (!to) return;
    await (to.trackIndex !== activeIdx ? skipToIndex(to.trackIndex) : seekTo(to.position));
  }

  async function mark() {
    if (!book) return;
    await addBookmark(book, { position: pos || 0, trackIndex: activeIdx, createdAt: Date.now() });
    setMarked(true);
    clearTimeout(markTimer.current);
    markTimer.current = setTimeout(() => setMarked(false), 1500);
  }

  return (
    <View style={[styles.wrap, { paddingTop: topPad }]}>
      <TouchableOpacity onPress={nav.goBack} style={styles.done} accessibilityLabel="Leave car mode" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <ChevronIcon dir="down" size={22} color={theme.text} />
        <Text style={styles.doneTxt}>Car mode</Text>
      </TouchableOpacity>

      {!book ? (
        <View style={styles.center}><Text style={styles.where}>Nothing is playing.</Text></View>
      ) : (
        <>
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={2}>{book.title}</Text>
            <Text style={styles.where} numberOfLines={2}>{where}</Text>
            {left != null ? <Text style={styles.left}>{formatDuration(left)} left in {chapter || files.length > 1 ? unit : "book"}</Text> : null}
          </View>

          <View style={styles.mainRow}>
            <TouchableOpacity style={styles.jump} onPress={() => seekBy(-settings.jumpBack).catch(() => {})} accessibilityLabel={`Back ${settings.jumpBack} seconds`}>
              <JumpIcon dir="back" seconds={settings.jumpBack} size={72} color={theme.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => (playing ? pause() : play()).catch(() => {})} accessibilityLabel={playing ? "Pause" : "Play"} activeOpacity={0.85}>
              <LinearGradient colors={theme.buttonGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.play}>
                <PlayPauseIcon playing={playing} size={52} />
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity style={styles.jump} onPress={() => seekBy(settings.jumpForward).catch(() => {})} accessibilityLabel={`Forward ${settings.jumpForward} seconds`}>
              <JumpIcon dir="forward" seconds={settings.jumpForward} size={72} color={theme.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.stepRow}>
            <TouchableOpacity
              style={styles.big}
              onPress={() => go(previousStep(chapters, pos, activeIdx)).catch(() => {})}
              accessibilityLabel={`Previous ${unit}`}
            >
              <SkipIcon dir="prev" size={30} color={theme.text} />
              <Text style={styles.bigTxt}>{unit === "chapter" ? "Chapter" : "Part"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.big, !forward && styles.off]}
              disabled={!forward}
              onPress={() => go(forward).catch(() => {})}
              accessibilityLabel={`Next ${unit}`}
            >
              <Text style={styles.bigTxt}>{unit === "chapter" ? "Chapter" : "Part"}</Text>
              <SkipIcon dir="next" size={30} color={theme.text} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[styles.big, styles.mark, marked && styles.marked]} onPress={mark} accessibilityLabel="Add a bookmark here">
            <Text style={styles.bigTxt}>{marked ? "Bookmarked ✓" : "+ Bookmark"}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#0b0810", paddingHorizontal: 20, paddingBottom: 28 },
  done: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", paddingVertical: 8 },
  doneTxt: { color: theme.sub, fontSize: 15, fontWeight: "700", letterSpacing: 0.5 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  info: { flex: 1, justifyContent: "center", alignItems: "center", gap: 8 },
  title: { color: theme.text, fontSize: 26, fontWeight: "800", textAlign: "center" },
  where: { color: theme.sub, fontSize: 19, textAlign: "center" },
  left: { color: theme.dim, fontSize: 16, fontVariant: ["tabular-nums"] },
  mainRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 26 },
  jump: { width: 96, height: 96, alignItems: "center", justifyContent: "center" },
  play: { width: 132, height: 132, borderRadius: 66, alignItems: "center", justifyContent: "center" },
  stepRow: { flexDirection: "row", gap: 14, marginBottom: 14 },
  big: {
    flex: 1, minHeight: 76, borderRadius: 20, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12,
  },
  bigTxt: { color: theme.text, fontSize: 20, fontWeight: "700" },
  off: { opacity: 0.35 },
  mark: { flex: 0 },
  marked: { borderColor: theme.good },
});
