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
import React, { useState, useRef, useCallback, useMemo } from "react";
import {
  View, Text, Image, FlatList, TouchableOpacity, TouchableWithoutFeedback,
  StyleSheet, useWindowDimensions, StatusBar as RNStatusBar,
} from "react-native";
import { theme } from "../src/theme";
import { getStreams } from "../src/api";
import { updateProgress } from "../src/library";
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
  const { width } = useWindowDimensions();

  const [pages, setPages] = useState(params.pages || []);
  const [chrome, setChrome] = useState(false);
  const [page, setPage] = useState(startPage);

  const listRef = useRef(null);
  const aspectsRef = useRef({}); // pageIndex -> measured height/width
  const lastSave = useRef(0);
  const lastRecovery = useRef(0);
  // Guards the resume point: mount-time viewability events report page 0
  // before the restore-scroll lands, and persisting those would wipe the
  // saved position. Saves unlock once the user actually touches the list
  // (or immediately when there's nothing to restore).
  const interacted = useRef(!startPage);
  const total = pages.length;

  const isRemote = useMemo(() => pages.some((p) => /^https?:/.test(p)), [pages]);

  function saveProgress(p) {
    if (!entry.id) return;
    if (!interacted.current && p < startPage) return; // pre-restore noise
    const now = Date.now();
    if (now - lastSave.current < 2000 && p < total - 1) return; // throttle writes
    lastSave.current = now;
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

  // Expired TorBox link mid-read → re-resolve once per 30s and swap URLs.
  const recover = useCallback(async () => {
    if (!isRemote || !entry.id) return;
    const now = Date.now();
    if (now - lastRecovery.current < 30000) return;
    lastRecovery.current = now;
    try {
      const fresh = await getStreams(entry.id);
      if (!fresh || !fresh.ready) return;
      const plan = classifyStreams(fresh.streams);
      if (plan.mode === "images" && plan.images.length > 0) {
        setPages(plan.images.map((s) => s.url));
      }
    } catch (_) {
      /* stay on the stale URLs; the user can back out and reopen */
    }
  }, [isRemote, entry.id]);

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
          <Text style={styles.chromeTitle} numberOfLines={1}>{entry.title || "Comic"}</Text>
        </View>
      )}
      {chrome && total > 0 && (
        <View style={styles.chromeBottom}>
          <Text style={styles.pageTxt}>Page {Math.min(page + 1, total)} / {total}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, Math.round(((page + 1) / total) * 100))}%` }]} />
          </View>
        </View>
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
});

function ListEmpty() {
  return (
    <View style={styles.empty}><Text style={styles.emptyTxt}>No pages to show.</Text></View>
  );
}
