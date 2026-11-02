// src/ui.js — small shared UI pieces built on expo-linear-gradient.
import React, { useEffect, useState } from "react";
import { View, Text, Image, TouchableOpacity, StyleSheet, Modal, ScrollView, Animated, KeyboardAvoidingView, Platform, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "./theme";

// Wall-clock time for countdowns, ticking each second only while needed.
export function useClock(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [active]);
  return now;
}

// Placeholder rows shaped like search results, gently pulsing while they load.
export function SkeletonRows({ count = 6 }) {
  const [pulse] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.5, duration: 650, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View style={{ opacity: pulse }} accessibilityLabel="Loading results" accessible>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.skelRow}>
          <View style={styles.skelCover} />
          <View style={{ flex: 1, gap: 8, justifyContent: "center" }}>
            <View style={[styles.skelLine, { width: `${78 - (i % 3) * 12}%` }]} />
            <View style={[styles.skelLine, { width: "45%", height: 10 }]} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

// Bottom sheet: tap outside or Android back to close.
export function Sheet({ visible, onClose, title, children, maxHeight = 460 }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.sheetBackdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessible={false} />
        <View style={[styles.sheet, { paddingBottom: 16 + insets.bottom, maxHeight: height - insets.top - 24 }]} accessibilityViewIsModal>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeading}>
            {title ? <Text style={styles.sheetTitle} accessibilityRole="header">{title}</Text> : null}
            <TouchableOpacity style={styles.sheetClose} onPress={onClose} accessibilityRole="button" accessibilityLabel={`Close ${title || "sheet"}`}>
              <Text style={styles.actionLabel}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: Math.min(maxHeight, height - insets.top - insets.bottom - 120), flexShrink: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// A sheet of actions: [{ label, hint?, onPress, destructive? }]. The sheet
// closes before the action runs, so actions can open alerts or navigate.
export function ActionSheet({ visible, onClose, title, actions }) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {actions.map((action) => (
        <TouchableOpacity
          key={action.label}
          style={styles.action}
          onPress={() => { onClose(); action.onPress(); }}
          accessibilityRole="button"
        >
          <Text style={[styles.actionLabel, action.destructive && { color: theme.danger }]}>{action.label}</Text>
          {action.hint ? <Text style={styles.actionHint}>{action.hint}</Text> : null}
        </TouchableOpacity>
      ))}
    </Sheet>
  );
}

// A full-screen gradient you drop behind a screen's content.
export function Backdrop({ colors }) {
  return (
    <LinearGradient
      colors={colors || theme.playerGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}

// The book's own cover, heavily blurred and darkened, behind a screen or a
// header. Falls back to the plain gradient when there's no cover.
export function CoverBackdrop({ uri, style }) {
  if (!uri) return <Backdrop />;
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Image source={{ uri }} style={StyleSheet.absoluteFill} blurRadius={40} resizeMode="cover" />
      <LinearGradient
        colors={["#15101cb3", "#15101ce6", theme.bg]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

// Cover image, or a nice gradient placeholder with a ♪ when there's no art.
export function CoverArt({ uri, size = 56, radius = 8, glyph }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius, backgroundColor: theme.card }} />;
  }
  return (
    <LinearGradient
      colors={theme.coverGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: radius, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ color: "#ffffffb0", fontSize: glyph || Math.round(size * 0.4) }}>♪</Text>
    </LinearGradient>
  );
}

const STAR_COLOR = "#fbbf24";

// 1–5 stars. With onChange they're buttons (tap the current rating to clear).
export function Stars({ value = 0, onChange, size = 22 }) {
  return (
    <View style={{ flexDirection: "row", gap: Math.round(size * 0.2) }} accessibilityLabel={onChange ? undefined : `Rated ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const star = <Text style={{ fontSize: size, lineHeight: size * 1.2, color: n <= value ? STAR_COLOR : theme.border }}>★</Text>;
        return onChange ? (
          <TouchableOpacity
            key={n}
            onPress={() => onChange(n === value ? 0 : n)}
            style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}
            accessibilityRole="button"
            accessibilityLabel={`${n} star${n === 1 ? "" : "s"}`}
            accessibilityState={{ selected: n <= value }}
          >
            {star}
          </TouchableOpacity>
        ) : <View key={n}>{star}</View>;
      })}
    </View>
  );
}

// "★★★★☆" for one-line labels.
export function starText(value) {
  return value > 0 ? "★".repeat(value) + "☆".repeat(5 - value) : "";
}

// Primary gradient button.
export function GradientButton({ title, onPress, disabled, style, textStyle, children }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.85} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} style={[styles.wrap, disabled && { opacity: 0.5 }, style]}>
      <LinearGradient colors={theme.buttonGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.grad}>
        {children || <Text style={[styles.txt, textStyle]}>{title}</Text>}
      </LinearGradient>
    </TouchableOpacity>
  );
}

// Crisp play/pause icon drawn with Views (no glyph fonts, sharp at any size).
export function PlayPauseIcon({ playing, size = 26, color = "#fff" }) {
  if (playing) {
    const barW = Math.max(3, Math.round(size * 0.17));
    const barH = Math.round(size * 0.94);
    const gap = Math.round(size * 0.2);
    return (
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", width: size, height: size }}>
        <View style={{ width: barW, height: barH, backgroundColor: color, borderRadius: barW / 2, marginRight: gap / 2 }} />
        <View style={{ width: barW, height: barH, backgroundColor: color, borderRadius: barW / 2, marginLeft: gap / 2 }} />
      </View>
    );
  }
  // right-pointing triangle via the CSS-border trick, nudged right for optical centering.
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: size * 0.44,
          borderBottomWidth: size * 0.44,
          borderLeftWidth: size * 0.72,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderLeftColor: color,
          marginLeft: size * 0.16,
        }}
      />
    </View>
  );
}


const styles = StyleSheet.create({
  skelRow: { flexDirection: "row", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  skelCover: { width: 56, height: 56, borderRadius: 6, backgroundColor: theme.card },
  skelLine: { height: 13, borderRadius: 6, backgroundColor: theme.card },
  sheetBackdrop: { flex: 1, backgroundColor: "#00000088", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.card, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingTop: 10,
  },
  sheetHandle: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: theme.border, marginBottom: 10 },
  sheetHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sheetClose: { minWidth: 56, minHeight: 48, alignItems: "center", justifyContent: "center" },
  sheetTitle: { flex: 1, color: theme.sub, fontWeight: "700", fontSize: 13, textTransform: "uppercase", marginLeft: 12 },
  action: { minHeight: 48, justifyContent: "center", paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10 },
  actionLabel: { color: theme.text, fontSize: 16, fontWeight: "600" },
  actionHint: { color: theme.dim, fontSize: 12, marginTop: 2 },
  wrap: { borderRadius: 12, overflow: "hidden" },
  grad: { minHeight: 48, paddingVertical: 15, alignItems: "center", justifyContent: "center" },
  txt: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
