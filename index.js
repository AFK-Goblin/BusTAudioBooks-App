import { registerRootComponent } from "expo";
import TrackPlayer from "@rntp/player";
import App from "./App";
// Defines the background check (TaskManager needs it at load, even when
// Android starts the app only to run it).
import "./src/backgroundCheck";

registerRootComponent(App);

// Background playback service — runs even when the app is backgrounded/screen off.
TrackPlayer.registerBackgroundEventHandler(() => require("./service"));
