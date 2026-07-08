// src/ui.js — small shared UI pieces built on expo-linear-gradient.
import React from "react";
import { View, Text, Image, TouchableOpacity, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { theme } from "./theme";

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

// Primary gradient button.
export function GradientButton({ title, onPress, disabled, style, textStyle, children }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.85} style={[styles.wrap, style]}>
      <LinearGradient colors={theme.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.grad}>
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
  wrap: { borderRadius: 12, overflow: "hidden" },
  grad: { paddingVertical: 15, alignItems: "center", justifyContent: "center" },
  txt: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
