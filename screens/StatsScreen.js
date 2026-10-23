import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { theme } from "../src/theme";
import { formatDuration } from "../src/format";
import { useListening, summarize, dailySeries } from "../src/stats";
import { finishedBooks, getLibrary } from "../src/library";
import { useSettings, setSetting, DAILY_GOAL_OPTIONS } from "../src/settings";
import { CoverArt, starText } from "../src/ui";
import { ChevronIcon } from "../src/icons";
import { useScreenPad } from "../src/layout";

const CHART_DAYS = 14;
const CHART_HEIGHT = 120;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RECENT_FINISHED = 6;
const TOP_BOOKS = 5;

function shortDate(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export default function StatsScreen({ nav }) {
  const topPad = useScreenPad();
  const listening = useListening();
  const days = listening && listening.days;
  const settings = useSettings();
  const [finished, setFinished] = useState([]);
  const [library, setLibrary] = useState({});
  useEffect(() => {
    let alive = true;
    finishedBooks().then((books) => { if (alive) setFinished(books); }).catch(() => {});
    getLibrary().then((lib) => { if (alive) setLibrary(lib); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  // The books you've spent the most time in (still in your library).
  const top = Object.entries((listening && listening.books) || {})
    .filter(([id, seconds]) => library[id] && seconds >= 60)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_BOOKS)
    .map(([id, seconds]) => ({ book: library[id], seconds }));

  const goal = (settings.dailyGoal || 0) * 60;
  const stats = summarize(days || {});
  const series = dailySeries(days || {}, CHART_DAYS);
  const fortnight = series.reduce((sum, d) => sum + d.seconds, 0);
  const peak = Math.max(60, goal, ...series.map((d) => d.seconds));
  const goalMet = goal > 0 && stats.today >= goal;
  const thisYear = new Date().getFullYear();
  const finishedThisYear = finished.filter((b) => new Date(b.progress.lastPlayed || 0).getFullYear() === thisYear).length;

  return (
    <View style={[styles.wrap, { paddingTop: topPad }]}>
      <TouchableOpacity onPress={nav.goBack} style={styles.backRow}>
        <ChevronIcon dir="left" size={18} color={theme.accent} />
        <Text style={styles.back}>Back</Text>
      </TouchableOpacity>
      <Text style={styles.brand}>Your listening</Text>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.kicker}>TODAY</Text>
          <Text style={styles.big}>{formatDuration(stats.today)}</Text>
          {goal > 0 ? (
            <>
              <View style={styles.goalTrack}>
                <View style={[styles.goalFill, { width: `${Math.min(100, (stats.today / goal) * 100)}%` }, goalMet && { backgroundColor: theme.good }]} />
              </View>
              <Text style={styles.note}>
                {goalMet ? "Daily goal reached 🎉" : `${formatDuration(goal - stats.today)} to go · goal ${settings.dailyGoal} min a day`}
              </Text>
            </>
          ) : (
            <Text style={styles.note}>{days && stats.total < 60 ? "Start a book and your listening shows up here." : "Set a daily goal below to track it here."}</Text>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.kicker}>LAST 2 WEEKS</Text>
            <Text style={styles.headValue}>{formatDuration(fortnight)}</Text>
          </View>
          <View
            style={styles.chart}
            accessible
            accessibilityLabel={`Last 2 weeks: ${series.map((d) => `${WEEKDAYS[new Date(d.time).getDay()]} ${formatDuration(d.seconds)}`).join(", ")}`}
          >
            {goal > 0 ? <View style={[styles.goalLine, { bottom: (goal / peak) * CHART_HEIGHT }]} /> : null}
            {series.map((d, i) => {
              const height = d.seconds > 0 ? Math.max(3, (d.seconds / peak) * CHART_HEIGHT) : 0;
              const color = goal > 0 && d.seconds >= goal ? theme.good : i === series.length - 1 ? theme.accent : theme.accent2;
              return (
                <View key={d.key} style={styles.barSlot}>
                  <View style={[styles.bar, { height, backgroundColor: color }]} />
                </View>
              );
            })}
          </View>
          <View style={styles.labels}>
            {series.map((d, i) => (
              <Text key={d.key} style={[styles.barLabel, i === series.length - 1 && styles.barLabelToday]}>
                {WEEKDAYS[new Date(d.time).getDay()][0]}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.tiles}>
          <Tile label="Last 7 days" value={formatDuration(stats.week)} />
          <Tile label="Last 30 days" value={formatDuration(stats.month)} />
          <Tile label="Daily average" value={formatDuration(stats.month / 30)} sub="over 30 days" />
          <Tile label="All time" value={formatDuration(stats.total)} sub={`${stats.activeDays} day${stats.activeDays === 1 ? "" : "s"} listened`} />
          <Tile label="Streak" value={`${stats.streak} day${stats.streak === 1 ? "" : "s"}`} sub={`Best ${stats.best}`} />
          <Tile label="Books finished" value={String(finished.length)} sub={`${finishedThisYear} this year`} />
        </View>

        <Text style={styles.section}>Daily goal</Text>
        <View style={styles.chips}>
          {DAILY_GOAL_OPTIONS.map((minutes) => {
            const active = (settings.dailyGoal || 0) === minutes;
            return (
              <TouchableOpacity
                key={minutes}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setSetting("dailyGoal", minutes)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{minutes ? `${minutes} min` : "Off"}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {top.length > 0 ? (
          <>
            <Text style={styles.section}>Most listened</Text>
            {top.map(({ book, seconds }, i) => (
              <TouchableOpacity key={book.id} style={styles.row} onPress={() => nav.navigate("book", { item: book })}>
                <Text style={styles.rank}>{i + 1}</Text>
                <CoverArt uri={book.poster} size={44} radius={6} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{book.title}</Text>
                  {book.author ? <Text style={styles.rowMeta} numberOfLines={1}>{book.author}</Text> : null}
                </View>
                <Text style={styles.topTime}>{formatDuration(seconds)}</Text>
              </TouchableOpacity>
            ))}
          </>
        ) : null}

        {finished.length > 0 ? (
          <>
            <Text style={styles.section}>Recently finished</Text>
            {finished.slice(0, RECENT_FINISHED).map((book) => (
              <TouchableOpacity key={book.id} style={styles.row} onPress={() => nav.navigate("book", { item: book })}>
                <CoverArt uri={book.poster} size={44} radius={6} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{book.title}</Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {[starText(book.rating), book.author, book.progress.lastPlayed ? `finished ${shortDate(book.progress.lastPlayed)}` : null].filter(Boolean).join(" · ")}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Tile({ label, value, sub }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
      {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 10 },
  back: { color: theme.accent, fontSize: 16 },
  brand: { color: theme.text, fontSize: 22, fontWeight: "800", marginBottom: 12 },
  card: { backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 16, marginBottom: 12 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  kicker: { color: theme.sub, fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  headValue: { color: theme.text, fontWeight: "700" },
  big: { color: theme.text, fontSize: 36, fontWeight: "800", marginTop: 4, fontVariant: ["tabular-nums"] },
  goalTrack: { height: 8, borderRadius: 4, backgroundColor: theme.border, marginTop: 12, overflow: "hidden" },
  goalFill: { height: 8, borderRadius: 4, backgroundColor: theme.accent },
  note: { color: theme.dim, fontSize: 12, marginTop: 8 },
  chart: { height: CHART_HEIGHT, flexDirection: "row", alignItems: "flex-end", gap: 4, marginTop: 16 },
  goalLine: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: theme.good + "88" },
  barSlot: { flex: 1, height: CHART_HEIGHT, justifyContent: "flex-end" },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  labels: { flexDirection: "row", gap: 4, marginTop: 6 },
  barLabel: { flex: 1, textAlign: "center", color: theme.dim, fontSize: 11 },
  barLabelToday: { color: theme.text, fontWeight: "700" },
  tiles: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  tile: { width: "48.5%", backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 14 },
  tileLabel: { color: theme.sub, fontSize: 12 },
  tileValue: { color: theme.text, fontSize: 20, fontWeight: "800", marginTop: 4, fontVariant: ["tabular-nums"] },
  tileSub: { color: theme.dim, fontSize: 11, marginTop: 2 },
  section: { color: theme.sub, fontWeight: "700", fontSize: 13, textTransform: "uppercase", marginTop: 22, marginBottom: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 7 },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipTxt: { color: theme.sub, fontWeight: "600", fontSize: 13 },
  chipTxtActive: { color: "#fff" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: theme.border },
  rowTitle: { color: theme.text, fontWeight: "600" },
  rowMeta: { color: theme.dim, fontSize: 12, marginTop: 2 },
  rank: { color: theme.dim, fontWeight: "800", width: 16, textAlign: "center", fontVariant: ["tabular-nums"] },
  topTime: { color: theme.text, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
