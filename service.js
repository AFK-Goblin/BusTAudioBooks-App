// service.js — handles lock-screen / notification / headset controls.
const TrackPlayer = require("react-native-track-player").default;
const { Event } = require("react-native-track-player");

module.exports = async function () {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.stop());
  TrackPlayer.addEventListener(Event.RemoteNext, () =>
    TrackPlayer.skipToNext().catch(() => {})
  );
  TrackPlayer.addEventListener(Event.RemotePrevious, () =>
    TrackPlayer.skipToPrevious().catch(() => {})
  );
  TrackPlayer.addEventListener(Event.RemoteJumpForward, async (e) => {
    const p = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(p.position + (e.interval || 30));
  });
  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async (e) => {
    const p = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(Math.max(0, p.position - (e.interval || 15)));
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, (e) => TrackPlayer.seekTo(e.position));
};
