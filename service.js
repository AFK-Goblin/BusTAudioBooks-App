const { Event } = require("@rntp/player");
const { handleBackgroundEvent } = require("./src/playback/background");
const { playbackSession } = require("./src/playback/runtime");

const events = {
  progress: Event.PlaybackProgressUpdated,
  playing: Event.IsPlayingChanged,
  sleep: Event.SleepTimerTriggered,
  play: Event.RemotePlay,
  pause: Event.RemotePause,
  stop: Event.RemoteStop,
  next: Event.RemoteNext,
  previous: Event.RemotePrevious,
  forward: Event.RemoteSkipForward,
  backward: Event.RemoteSkipBackward,
  seek: Event.RemoteSeek,
  noisy: "event.audio-becoming-noisy",
};

module.exports = (event) => handleBackgroundEvent(event, playbackSession, events);
