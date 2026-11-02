import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Easing, I18nManager, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

// Call once per screen, then share the preference with its titles.
export function useTitleMotion() {
  const [reduced, setReduced] = useState(true);
  const [reader, setReader] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");
  useEffect(() => {
    let alive = true;
    let reducedChanged = false;
    let readerChanged = false;
    const subscriptions = [
      AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => { reducedChanged = true; setReduced(value); }),
      AccessibilityInfo.addEventListener("screenReaderChanged", (value) => { readerChanged = true; setReader(value); }),
      AppState.addEventListener("change", (state) => setForeground(state === "active")),
    ];
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (alive && !reducedChanged) setReduced(value); }).catch(() => {});
    AccessibilityInfo.isScreenReaderEnabled().then((value) => { if (alive && !readerChanged) setReader(value); }).catch(() => {});
    return () => { alive = false; subscriptions.forEach((subscription) => subscription.remove()); };
  }, []);
  return foreground && !reduced && !reader && !I18nManager.isRTL;
}

export function ScrollingTitle({ children, animate = false, style, textStyle }) {
  const { fontScale } = useWindowDimensions();
  const title = String(children ?? "");
  // Wrapping also keeps the entire title readable without any animation.
  if (!animate) return <View style={style}><Text style={textStyle}>{title}</Text></View>;
  return <MeasuredTitle key={`${title}:${fontScale}`} title={title} style={style} textStyle={textStyle} />;
}

function MeasuredTitle({ title, style, textStyle }) {
  const [offset] = useState(() => new Animated.Value(0));
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const distance = Math.max(0, content - viewport);
  useEffect(() => {
    offset.setValue(0);
    if (!viewport || distance <= 1) return undefined;
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(1400),
      Animated.timing(offset, { toValue: -distance, duration: Math.max(1800, distance / 28 * 1000), easing: Easing.linear, useNativeDriver: true, isInteraction: false }),
      Animated.delay(1800),
      Animated.timing(offset, { toValue: 0, duration: 0, useNativeDriver: true, isInteraction: false }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [distance, viewport, offset]);
  return (
    <View style={[styles.viewport, style]} testID="title-viewport" onLayout={(event) => setViewport(event.nativeEvent.layout.width)}>
      <ScrollView
        horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false}
        testID="title-measure" onContentSizeChange={(width) => setContent(width)}
        contentContainerStyle={styles.content} pointerEvents="none"
      >
        <Animated.Text accessibilityLabel={title} style={[textStyle, { transform: [{ translateX: offset }] }]} numberOfLines={1}>{title}</Animated.Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { overflow: "hidden", minWidth: 0 },
  content: { flexGrow: 1, justifyContent: "center" },
});
