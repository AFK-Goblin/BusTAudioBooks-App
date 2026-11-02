import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, SectionList, Share } from "react-native";
import { theme } from "../src/theme";
import { bookmarkedBooks, getBook, removeBookmark } from "../src/library";
import { bookmarkPlace, bookmarksText } from "../src/bookmarks";
import { playFrom } from "../src/player";
import { CoverArt } from "../src/ui";
import { ChevronIcon, CloseIcon, NoteGlyph } from "../src/icons";
import { useScreenPad } from "../src/layout";

const inBookOrder = (a, b) => (a.trackIndex || 0) - (b.trackIndex || 0) || (a.position || 0) - (b.position || 0);

// Every bookmark in every book, grouped by book (most recently bookmarked
// first). Tapping one plays the book from there.
export default function BookmarksScreen({ nav }) {
  const topPad = useScreenPad();
  const [books, setBooks] = useState(null);
  const [notesOnly, setNotesOnly] = useState(false);

  const load = useCallback(() => {
    bookmarkedBooks().then(setBooks).catch(() => setBooks([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const hasNotes = (books || []).some((b) => b.bookmarks.some((bm) => bm.note));
  const sections = (books || [])
    .map((book) => ({ book, data: book.bookmarks.filter((bm) => !notesOnly || bm.note).sort(inBookOrder) }))
    .filter((section) => section.data.length > 0);

  async function open(book, bm) {
    const fresh = (await getBook(book.id).catch(() => null)) || book;
    if (!fresh.files || fresh.files.length === 0) {
      // Nothing to play yet (never streamed here, or restored from a backup).
      nav.navigate("book", { item: fresh });
      return;
    }
    try {
      await playFrom(fresh, bm.trackIndex || 0, bm.position || 0);
      nav.navigate("player");
    } catch (_) {
      nav.navigate("book", { item: fresh });
    }
  }

  async function remove(book, bm) {
    await removeBookmark(book.id, bm.createdAt);
    load();
  }

  return (
    <View style={[styles.wrap, { paddingTop: topPad }]}>
      <TouchableOpacity onPress={nav.goBack} style={styles.backRow}>
        <ChevronIcon dir="left" size={18} color={theme.accent} />
        <Text style={styles.back}>Back</Text>
      </TouchableOpacity>
      <View style={styles.headRow}>
        <Text style={styles.brand}>Bookmarks</Text>
        {hasNotes ? (
          <TouchableOpacity
            style={[styles.filter, notesOnly && styles.filterOn]}
            onPress={() => setNotesOnly((v) => !v)}
            accessibilityRole="switch"
            accessibilityState={{ checked: notesOnly }}
          >
            <Text style={[styles.filterTxt, notesOnly && styles.filterTxtOn]}>With notes</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(bm) => String(bm.createdAt)}
        contentContainerStyle={{ paddingBottom: 100 }}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.bookHead}>
            <CoverArt uri={section.book.poster} size={40} radius={6} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bookTitle} numberOfLines={1}>{section.book.title}</Text>
              <Text style={styles.bookMeta} numberOfLines={1}>
                {section.book.bookmarks.length} bookmark{section.book.bookmarks.length === 1 ? "" : "s"}
                {section.book.author ? ` · ${section.book.author}` : ""}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => Share.share({ title: section.book.title, message: bookmarksText(section.book) }).catch(() => {})}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={`Share bookmarks from ${section.book.title}`}
            >
              <Text style={styles.share}>Share</Text>
            </TouchableOpacity>
          </View>
        )}
        renderItem={({ item: bm, section }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => open(section.book, bm)}
            accessibilityLabel={`Play ${section.book.title} from ${bookmarkPlace(section.book, bm)}${bm.note ? `. ${bm.note}` : ""}`}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.place}>{bookmarkPlace(section.book, bm)}</Text>
              {bm.note ? <Text style={styles.note}>{bm.note}</Text> : null}
            </View>
            <TouchableOpacity onPress={() => remove(section.book, bm)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Delete bookmark">
              <CloseIcon size={12} color={theme.dim} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          books ? (
            <View style={styles.emptyBox}>
              <NoteGlyph size={38} color={theme.border} />
              <Text style={styles.empty}>
                {notesOnly ? "No bookmarks with notes." : "No bookmarks yet.\nIn the player, tap + Bookmark (or long-press play) to keep your place in a book."}
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 10 },
  back: { color: theme.accent, fontSize: 16 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  brand: { color: theme.text, fontSize: 22, fontWeight: "800" },
  filter: { borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  filterOn: { backgroundColor: theme.button, borderColor: theme.accent },
  filterTxt: { color: theme.sub, fontWeight: "600", fontSize: 13 },
  filterTxtOn: { color: "#fff" },
  bookHead: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 18, marginBottom: 4 },
  bookTitle: { color: theme.text, fontWeight: "700" },
  bookMeta: { color: theme.dim, fontSize: 12, marginTop: 1 },
  share: { color: theme.accent, fontWeight: "700", fontSize: 13 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingLeft: 52, paddingRight: 4,
    borderBottomWidth: 1, borderBottomColor: theme.border,
  },
  place: { color: theme.text, fontWeight: "600", fontVariant: ["tabular-nums"] },
  note: { color: theme.sub, fontSize: 13, marginTop: 3, lineHeight: 18 },
  emptyBox: { alignItems: "center", marginTop: 60, gap: 10, paddingHorizontal: 30 },
  empty: { color: theme.dim, textAlign: "center", lineHeight: 20 },
});
