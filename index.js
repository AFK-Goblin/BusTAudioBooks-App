import { registerRootComponent } from "expo";
import TrackPlayer from "@rntp/player";
import App from "./App";

registerRootComponent(App);

// Background playback service — runs even when the app is backgrounded/screen off.
TrackPlayer.registerBackgroundEventHandler(() => require("./service"));
