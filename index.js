import { registerRootComponent } from "expo";
import TrackPlayer from "react-native-track-player";
import App from "./App";

registerRootComponent(App);

// Background playback service — runs even when the app is backgrounded/screen off.
TrackPlayer.registerPlaybackService(() => require("./service"));
