/* global test, beforeEach, afterEach */
import React from "react";
import { AccessibilityInfo, Animated, AppState } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ScrollingTitle, useTitleMotion } from "../components/ScrollingTitle";

const title = "Chapter twenty: A very long journey through the mountains";
let start, stop, listeners;
beforeEach(() => {
  start = jest.fn(); stop = jest.fn(); listeners = {};
  jest.spyOn(Animated, "loop").mockReturnValue({ start, stop });
  jest.spyOn(Animated, "timing");
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation((event, callback) => {
    listeners[event] = callback;
    return { remove: jest.fn() };
  });
  jest.spyOn(AppState, "addEventListener").mockImplementation((event, callback) => {
    listeners.appState = callback;
    return { remove: jest.fn() };
  });
});
afterEach(() => jest.restoreAllMocks());

async function measure(width = 200, contentWidth = 560) {
  await fireEvent(screen.getByTestId("title-viewport"), "layout", { nativeEvent: { layout: { width } } });
  await fireEvent(screen.getByTestId("title-measure"), "contentSizeChange", contentWidth, 24);
}

function PreferenceTitle() {
  const animate = useTitleMotion();
  return <ScrollingTitle animate={animate}>{title}</ScrollingTitle>;
}

test("only overflowing titles animate and the whole ending is revealed", async () => {
  await render(<ScrollingTitle animate>{title}</ScrollingTitle>);
  await measure(200, 180);
  expect(start).not.toHaveBeenCalled();
  await measure();
  expect(start).toHaveBeenCalledTimes(1);
  expect(Animated.timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    toValue: -360, useNativeDriver: true, isInteraction: false,
  }));
  expect(screen.getByLabelText(title)).toBeTruthy();
});

test("title changes and unmount stop the old animation", async () => {
  const view = await render(<ScrollingTitle animate>{title}</ScrollingTitle>);
  await measure();
  await view.rerender(<ScrollingTitle animate>Next chapter</ScrollingTitle>);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledTimes(1);
  await measure(200, 300);
  await view.unmount();
  expect(stop).toHaveBeenCalledTimes(2);
});

test("resizing to fit stops scrolling", async () => {
  await render(<ScrollingTitle animate>{title}</ScrollingTitle>);
  await measure();
  await measure(600, 560);
  expect(stop).toHaveBeenCalledTimes(1);
});

test.each(["reduceMotionChanged", "screenReaderChanged"])("%s stops motion and exposes wrapped text", async (event) => {
  await render(<PreferenceTitle />);
  await measure();
  await act(() => listeners[event](true));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(screen.getByText(title).props.numberOfLines).toBeUndefined();
});

test("backgrounding stops motion and foregrounding can resume it", async () => {
  await render(<PreferenceTitle />);
  await measure();
  await act(() => listeners.appState("background"));
  expect(stop).toHaveBeenCalledTimes(1);
  await act(() => listeners.appState("active"));
  await measure();
  expect(start).toHaveBeenCalledTimes(2);
});
