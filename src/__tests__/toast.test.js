/* global test */
import React from "react";
import { Text } from "react-native";
import { render, screen, act } from "@testing-library/react-native";
import { showToast, useToast } from "../toast";

function Probe() {
  const toast = useToast();
  return <Text>{toast ? toast.text : "none"}</Text>;
}

test("a toast shows, is replaced by the next, and goes away by itself", async () => {
  jest.useFakeTimers();
  try {
    await render(<Probe />);
    await act(async () => { showToast("Downloaded “Dune”"); });
    expect(screen.getByText("Downloaded “Dune”")).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(3000); showToast("Second"); });
    expect(screen.getByText("Second")).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(3500); });
    expect(screen.getByText("Second")).toBeTruthy(); // the timer restarted for it
    await act(async () => { jest.advanceTimersByTime(600); });
    expect(screen.getByText("none")).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});
