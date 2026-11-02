/* global test */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { StartupNotice } from "../components/StartupNotice";

test("failed startup retry stays visible and another attempt can succeed", async () => {
  const retry = jest.fn().mockRejectedValueOnce(new Error("not ready")).mockResolvedValueOnce(undefined);
  const resolved = jest.fn();
  await render(<StartupNotice warning={{ stage: "player" }} onRetry={retry} onResolve={resolved} onDismiss={jest.fn()} />);
  await fireEvent.press(screen.getByLabelText("Retry audio player"));
  expect(await screen.findByText("Still unavailable. Try again in a moment.")).toBeTruthy();
  expect(resolved).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText("Retry audio player"));
  expect(resolved).toHaveBeenCalledWith("player");
});

test("startup recovery distinguishes downloads and supports dismissal", async () => {
  const dismiss = jest.fn();
  await render(<StartupNotice warning={{ stage: "downloads" }} onRetry={jest.fn()} onResolve={jest.fn()} onDismiss={dismiss} />);
  expect(screen.getByText("Downloads could not resume")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Dismiss startup notice"));
  expect(dismiss).toHaveBeenCalledWith("downloads");
});
