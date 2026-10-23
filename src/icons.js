// src/icons.js — crisp icons drawn with plain Views (no glyph fonts, no svg).
// Same idea as PlayPauseIcon in ui.js: renders identically on every OEM font.
import React from "react";
import { View, Text } from "react-native";
import { theme } from "./theme";

// Right/left-pointing triangle via the border trick.
function Tri({ w, h, color, dir = "right", style }) {
  const base = { width: 0, height: 0, borderTopWidth: h / 2, borderBottomWidth: h / 2, borderTopColor: "transparent", borderBottomColor: "transparent" };
  const side = dir === "right"
    ? { borderLeftWidth: w, borderLeftColor: color }
    : { borderRightWidth: w, borderRightColor: color };
  return <View style={[base, side, style]} />;
}

// ⏮ / ⏭ — triangle + end bar.
export function SkipIcon({ dir = "next", size = 22, color = theme.text }) {
  const barW = Math.max(2, Math.round(size * 0.13));
  const triW = size * 0.5;
  const triH = size * 0.62;
  const bar = <View style={{ width: barW, height: triH, backgroundColor: color, borderRadius: barW / 2 }} />;
  const tri = <Tri w={triW} h={triH} color={color} dir={dir === "next" ? "right" : "left"} />;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", width: size, height: size, gap: 1.5 }}>
      {dir === "next" ? tri : bar}
      {dir === "next" ? bar : tri}
    </View>
  );
}

// Jump back/forward: circle with the seconds inside and an arrowhead on top.
export function JumpIcon({ seconds = 30, dir = "forward", size = 40, color = theme.text }) {
  const stroke = Math.max(2, Math.round(size * 0.055));
  const headW = size * 0.22;
  const headH = size * 0.2;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{
        position: "absolute", top: size * 0.06, left: size * 0.06, right: size * 0.06, bottom: size * 0.06,
        borderRadius: size / 2, borderWidth: stroke, borderColor: color, opacity: 0.9,
      }} />
      <Tri
        w={headW} h={headH} color={color} dir={dir === "forward" ? "right" : "left"}
        style={{ position: "absolute", top: -headH * 0.18, [dir === "forward" ? "right" : "left"]: size * 0.16 }}
      />
      <Text style={{ color, fontSize: size * 0.34, fontWeight: "700" }}>{seconds}</Text>
    </View>
  );
}

// Down arrow into a tray.
export function DownloadIcon({ size = 16, color = theme.text }) {
  const stemW = Math.max(2, Math.round(size * 0.14));
  return (
    <View style={{ width: size, height: size, alignItems: "center" }}>
      <View style={{ width: stemW, height: size * 0.38, backgroundColor: color, borderRadius: stemW / 2 }} />
      <View style={{
        width: 0, height: 0, marginTop: -1,
        borderLeftWidth: size * 0.28, borderRightWidth: size * 0.28, borderTopWidth: size * 0.3,
        borderLeftColor: "transparent", borderRightColor: "transparent", borderTopColor: color,
      }} />
      <View style={{ width: size * 0.86, height: stemW, backgroundColor: color, borderRadius: stemW / 2, marginTop: size * 0.12 }} />
    </View>
  );
}

export function CheckIcon({ size = 14, color = theme.good }) {
  const stroke = Math.max(2, Math.round(size * 0.16));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{
        width: size * 0.9, height: size * 0.5,
        borderLeftWidth: stroke, borderBottomWidth: stroke, borderColor: color,
        transform: [{ rotate: "-45deg" }], marginTop: -size * 0.15,
      }} />
    </View>
  );
}

export function ChevronIcon({ dir = "left", size = 18, color = theme.accent }) {
  const s = size * 0.5;
  const stroke = Math.max(2, Math.round(size * 0.13));
  const rot = { left: "45deg", right: "225deg", up: "135deg", down: "-45deg" }[dir];
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{
        width: s, height: s, borderLeftWidth: stroke, borderBottomWidth: stroke, borderColor: color,
        transform: [{ rotate: rot }], marginLeft: dir === "left" ? size * 0.15 : dir === "right" ? -size * 0.15 : 0,
      }} />
    </View>
  );
}

export function CloseIcon({ size = 14, color = theme.text }) {
  const stroke = Math.max(2, Math.round(size * 0.14));
  const bar = { position: "absolute", width: size, height: stroke, borderRadius: stroke / 2, backgroundColor: color };
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={[bar, { transform: [{ rotate: "45deg" }] }]} />
      <View style={[bar, { transform: [{ rotate: "-45deg" }] }]} />
    </View>
  );
}

export function SearchIcon({ size = 22, color = theme.sub }) {
  const stroke = Math.max(2, Math.round(size * 0.09));
  const lens = size * 0.62;
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ width: lens, height: lens, borderRadius: lens / 2, borderWidth: stroke, borderColor: color, marginLeft: size * 0.05, marginTop: size * 0.05 }} />
      <View style={{
        position: "absolute", width: size * 0.34, height: stroke, borderRadius: stroke / 2, backgroundColor: color,
        bottom: size * 0.14, right: size * 0.02, transform: [{ rotate: "45deg" }],
      }} />
    </View>
  );
}

// Books on a shelf: two upright spines + one leaning.
export function LibraryIcon({ size = 22, color = theme.sub }) {
  const w = Math.max(3, Math.round(size * 0.16));
  const h = size * 0.78;
  const spine = { width: w, height: h, borderRadius: 1.5, backgroundColor: color };
  return (
    <View style={{ width: size, height: size, flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: size * 0.08, paddingBottom: size * 0.06 }}>
      <View style={spine} />
      <View style={[spine, { height: h * 0.88 }]} />
      <View style={[spine, { transform: [{ rotate: "14deg" }], marginLeft: size * 0.04 }]} />
    </View>
  );
}

// Sliders (settings): three tracks, offset knobs.
export function SlidersIcon({ size = 22, color = theme.sub }) {
  const track = Math.max(2, Math.round(size * 0.09));
  const knob = Math.round(size * 0.3);
  const rows = [0.22, 0.6, 0.32]; // knob position (fraction of width) per row
  return (
    <View style={{ width: size, height: size, justifyContent: "space-evenly", paddingVertical: size * 0.08 }}>
      {rows.map((x, i) => (
        <View key={i} style={{ height: knob, justifyContent: "center" }}>
          <View style={{ position: "absolute", left: 0, right: 0, height: track, borderRadius: track / 2, backgroundColor: color, opacity: 0.5 }} />
          <View style={{ position: "absolute", left: x * (size - knob), width: knob, height: knob, borderRadius: knob / 2, backgroundColor: color }} />
        </View>
      ))}
    </View>
  );
}

// House: roof triangle over a body.
export function HomeIcon({ size = 22, color = theme.sub }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "flex-end", paddingBottom: size * 0.05 }}>
      <View style={{
        width: 0, height: 0,
        borderLeftWidth: size * 0.44, borderRightWidth: size * 0.44, borderBottomWidth: size * 0.34,
        borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: color,
      }} />
      <View style={{ width: size * 0.58, height: size * 0.42, backgroundColor: color, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, marginTop: size * 0.03 }} />
    </View>
  );
}

// Vertical "more" dots.
export function DotsIcon({ size = 18, color = theme.dim }) {
  const d = Math.max(3, Math.round(size * 0.16));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "space-evenly", paddingVertical: size * 0.08 }}>
      <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: color }} />
      <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: color }} />
      <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: color }} />
    </View>
  );
}

// Musical note for empty states / placeholders (kept as text — it's decorative).
export function NoteGlyph({ size = 40, color = "#ffffff70" }) {
  return <Text style={{ fontSize: size, color }}>♪</Text>;
}
