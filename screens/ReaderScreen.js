// screens/ReaderScreen.js — the vertical webtoon-style comic reader.
//
// A FlatList of full-width page images. Each Page owns its measured aspect
// ratio locally (a shared ref preserves measurements across unmount/remount
// so scrolled-past pages keep their height), with a tall placeholder until
// known so scrolling stays stable.
//
// Progress is page-based and persisted to the library store — but never
// before the user's saved position has been restored: the FlatList fires
// viewability events for page 0 at mount, and persisting those would clobber
// the resume point.
//
// Streamed (remote-URL) pages self-heal like audio does: when a TorBox link
// expires mid-read, an image error triggers one throttled re-resolve via
// getStreams and the URLs are swapped in place (same pattern as
// player.js recoverStreams, but keyed off Image onError).
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  View, Text, Image, FlatList, TouchableOpacity, TouchableWithoutFeedback,
  ActivityIndicator, StyleSheet, useWindowDimensions, StatusBar as RNStatusBar,
} from "react-native";
import { theme } from "../src/theme";
import { getStreams, getPages } from "../src/api";
import { updateProgress, markChapterRead } from "../src/library";
import { classifyStreams } from "../src/comics";
import { ChevronIcon } from "../src/icons";

const PLACEHOLDER_ASPECT = 1.4; // height/width guess until the image loads

// FlatList forbids changing viewabilityConfig identity after mount.
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 30 };

function Page({ uri, width, initialAspect, onAspect, onError, onPress }) {
  // Aspect lives in the Page so a load only re-renders this one row.
  const [aspect, setAspect] = useState(initialAspect);
  const height = width * (aspect || PLACEHOLDER_ASPECT);
  return (
    <TouchableWithoutFeedback onPress={onPress}>
      <Image
        source={{ uri }}
        style={{ width, height, backgroundColor: "#000" }}
        resizeMode="contain"
        onLoad={(e) => {
          const src = e.nativeEvent && e.nativeEvent.source;
          if (src && src.width > 0 && src.height > 0) {
            const a = src.height / src.width;
            setAspect(a);
            onAspect(a); // remembered across unmount/remount
          }
        }}
        onError={onError}
      />
    </TouchableWithoutFeedback>
  );
}

export default function ReaderScreen({ nav, params }) {
  const entry = params.entry || {};
  const startPage = params.startPage || 0;
  // MangaDex mode: { mangaId, chapter:{id,num,title}, chapters:[...], saver }.
  // `chapter` changes on next-chapter rollover, so it lives in state.
  const md = params.md || null;
  const { width } = useWindowDimensions();

  const [pages, setPages] = useState(params.pages || []);
  const [chrome, setChrome] = useState(false);
  const [page, setPage] = useState(startPage);
  const [chapter, setChapter] = useState(md ? md.chapter : null);
  const [advancing, setAdvancing] = useState(false);

  const listRef = useRef(null);
  const aspectsRef = useRef({}); // pageIndex -> measured height/width
  const lastSave = useRef(0);
  const lastRecovery = useRef(0);
  // advance()/recover() await network calls that can outlive the screen.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  // Guards the resume point: mount-time viewability events report page 0
  // before the restore-scroll lands, and persisting those would wipe the
  // saved position. Saves unlock once the user actually touches the list
  // (or immediately when there's nothing to restore).
  const interacted = useRef(!startPage);
  // Mutable because next-chapter rollover resets the resume point to 0.
  const startPageRef = useRef(startPage);
  const total = pages.length;

  const isRemote = useMemo(() => pages.some((p) => /^https?:/.test(p)), [pages]);

  function saveProgress(p) {
    if (!entry.id) return;
    if (!interacted.current && p < startPageRef.current) return; // pre-restore noise
    const now = Date.now();
    if (now - lastSave.current < 2000 && p < total - 1) return; // throttle writes
    lastSave.current = now;
    if (chapter) {
      // Series progress: chapter + page. `finished` stays false — a series is
      // "done" per-chapter (readChapters), not as a whole.
      updateProgress(entry.id, {
        page: p,
        totalPages: total,
        finished: false,
        chapterId: chapter.id,
        chapterNum: chapter.num,
      }).catch(() => {});
      if (total > 0 && p >= total - 1) {
        markChapterRead(entry.id, chapter.id).catch(() => {});
      }
      return;
    }
    updateProgress(entry.id, {
      page: p,
      totalPages: total,
      finished: total > 0 && p >= total - 1,
    }).catch(() => {});
  }
  // FlatList forbids changing onViewableItemsChanged identity; saveProgress
  // captures fresh state per render — bridge the two through a ref.
  const saveRef = useRef(saveProgress);
  saveRef.current = saveProgress;
  const onViewable = useRef(({ viewableItems }) => {
    if (!viewableItems || viewableItems.length === 0) return;
    const first = viewableItems[0].index;
    if (first == null) return; // fast-fling events can carry a null index
    setPage(first);
    saveRef.current(first);
  });

  // Expired link mid-read → re-resolve once per 30s and swap URLs in place.
  // MangaDex page baseUrls die after ~15 min, so this fires routinely there;
  // torrent images go back through TorBox via getStreams.
  const recover = useCallback(async () => {
    if (!isRemote || !entry.id) return;
    const now = Date.now();
    if (now - lastRecovery.current < 30000) return;
    lastRecovery.current = now;
    try {
      if (chapter) {
        const fresh = await getPages(chapter.id, { saver: md && md.saver, fresh: true });
        if (alive.current && fresh && fresh.pages && fresh.pages.length > 0) setPages(fresh.pages);
        return;
      }
      const fresh = await getStreams(entry.id);
      if (!alive.current || !fresh || !fresh.ready) return;
      const plan = classifyStreams(fresh.streams);
      if (plan.mode === "images" && plan.images.length > 0) {
        setPages(plan.images.map((s) => s.url));
      }
    } catch (_) {
      /* stay on the stale URLs; the user can back out and reopen */
    }
  }, [isRemote, entry.id, chapter, md]);

  // Next chapter in the series (MD mode only), for the end-of-chapter pill.
  const nextChapter = useMemo(() => {
    if (!chapter || !md || !md.chapters) return null;
    const i = md.chapters.findIndex((c) => c.id === chapter.id);
    return i >= 0 ? md.chapters[i + 1] || null : null;
  }, [chapter, md]);

  async function advance() {
    if (!nextChapter || advancing) return;
    setAdvancing(true);
    try {
      markChapterRead(entry.id, chapter.id).catch(() => {});
      const fresh = await getPages(nextChapter.id, { saver: md && md.saver });
      if (!alive.current) return; // user backed out mid-fetch
      if (!fresh || !fresh.pages || fresh.pages.length === 0) throw new Error("no pages");
      aspectsRef.current = {}; // stale heights would corrupt the new layout
      interacted.current = true;
      startPageRef.current = 0;
      setChapter(nextChapter);
      setPages(fresh.pages);
      setPage(0);
      if (listRef.current) listRef.current.scrollToOffset({ offset: 0, animated: false });
      // Explicit write (beats the 2s throttle) so backing out right away
      // resumes at the new chapter's start.
      lastSave.current = Date.now();
      updateProgress(entry.id, {
        page: 0,
        totalPages: fresh.pages.length,
        finished: false,
        chapterId: nextChapter.id,
        chapterNum: nextChapter.num,
      }).catch(() => {});
    } catch (_) {
      /* keep the current chapter; the pill stays for another try */
    } finally {
      setAdvancing(false);
    }
  }

  const renderItem = useCallback(({ item, index }) => (
    <Page
      uri={item}
      width={width}
      initialAspect={aspectsRef.current[index]}
      onAspect={(a) => { aspectsRef.current[index] = a; }}
      onError={recover}
      onPress={() => setChrome((c) => !c)}
    />
  ), [width, recover]);

  // Resume: heights are unknown at mount, so scrollToIndex can fail — fall
  // back to an offset estimated with the placeholder aspect and let the list
  // settle. Approximate is fine; progress re-saves as the user scrolls.
  const scrollToStart = useCallback(() => {
    if (!startPage || !listRef.current) return;
    try {
      listRef.current.scrollToIndex({ index: startPage, animated: false });
    } catch (_) {
      listRef.current.scrollToOffset({ offset: startPage * width * PLACEHOLDER_ASPECT, animated: false });
    }
  }, [startPage, width]);

  return (
    <View style={styles.wrap}>
      <RNStatusBar hidden={!chrome} />
      <FlatList
        ref={listRef}
        data={pages}
        keyExtractor={(_, i) => String(i)}
        renderItem={renderItem}
        onLayout={scrollToStart}
        onScrollBeginDrag={() => { interacted.current = true; }}
        onScrollToIndexFailed={(info) => {
          listRef.current &&
            listRef.current.scrollToOffset({
              offset: info.index * width * PLACEHOLDER_ASPECT,
              animated: false,
            });
        }}
        onViewableItemsChanged={onViewable.current}
        viewabilityConfig={VIEWABILITY_CONFIG}
        initialNumToRender={4}
        windowSize={7}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={ListEmpty}
      />

      {chrome && (
        <View style={styles.chromeTop}>
          <TouchableOpacity onPress={nav.goBack} style={styles.backBtn}>
            <ChevronIcon dir="left" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.chromeTitle} numberOfLines={1}>
            {chapter ? `${entry.title || "Series"} — Ch. ${chapter.num || "?"}` : entry.title || "Comic"}
          </Text>
        </View>
      )}
      {chrome && total > 0 && (
        <View style={styles.chromeBottom}>
          <Text style={styles.pageTxt}>
            {chapter ? `Ch. ${chapter.num || "?"} · ` : ""}Page {Math.min(page + 1, total)} / {total}
          </Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, Math.round(((page + 1) / total) * 100))}%` }]} />
          </View>
        </View>
      )}

      {/* End-of-chapter pill (MD mode): visible regardless of chrome. Only
          rendered when we actually KNOW the chapter list — offline reads pass
          an empty list, where "caught up" would be a lie. */}
      {chapter && total > 0 && page >= total - 1 && md && md.chapters && md.chapters.length > 0 && (
        nextChapter ? (
          <TouchableOpacity
            style={[styles.nextPill, chrome && styles.nextPillRaised]}
            onPress={advance}
            disabled={advancing}
          >
            {advancing
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.nextTxt}>Next: Ch. {nextChapter.num || "?"} →</Text>}
          </TouchableOpacity>
        ) : (
          <View style={[styles.nextPill, styles.nextPillDone, chrome && styles.nextPillRaised]}>
            <Text style={styles.nextTxt}>You're caught up ✓</Text>
          </View>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#000" },
  chromeTop: {
    position: "absolute", top: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingTop: 40, paddingBottom: 12, paddingHorizontal: 12,
    backgroundColor: "#000000cc",
  },
  backBtn: { padding: 6 },
  chromeTitle: { color: "#fff", fontWeight: "700", fontSize: 15, flex: 1 },
  chromeBottom: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingVertical: 14, paddingHorizontal: 16, gap: 8,
    backgroundColor: "#000000cc",
  },
  pageTxt: { color: "#fff", fontSize: 13, fontWeight: "600", textAlign: "center" },
  track: { height: 4, backgroundColor: "#ffffff30", borderRadius: 2 },
  fill: { height: 4, backgroundColor: theme.accent, borderRadius: 2 },
  empty: { padding: 40, alignItems: "center" },
  emptyTxt: { color: "#ffffff80" },
  nextPill: {
    position: "absolute", bottom: 24, alignSelf: "center",
    backgroundColor: theme.accent, borderRadius: 22,
    paddingHorizontal: 22, paddingVertical: 12, minWidth: 150, alignItems: "center",
  },
  nextPillRaised: { bottom: 76 }, // clear the chrome bottom bar when visible
  nextPillDone: { backgroundColor: "#00000090", borderWidth: 1, borderColor: "#ffffff30" },
  nextTxt: { color: "#fff", fontWeight: "700", fontSize: 14 },
});

function ListEmpty() {
  return (
    <View style={styles.empty}><Text style={styles.emptyTxt}>No pages to show.</Text></View>
  );
}
