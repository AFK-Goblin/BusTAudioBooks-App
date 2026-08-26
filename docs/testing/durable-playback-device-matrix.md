# Durable Playback Android Device Matrix

Run this matrix on the release candidate using a physical Android phone. Use a
long single-file audiobook and a multipart audiobook. Never paste signed media
URLs or credentials into this document.

## Automated gate — 2026-08-26

| Check | Result |
|---|---|
| Jest | PASS — 23 suites, 88 tests |
| TypeScript | PASS |
| ESLint | PASS — 0 errors, 34 existing warnings |
| Expo Doctor | PASS — 21/21 checks |
| Android production export | PASS |

## Device setup

1. Enable Developer options and USB debugging.
2. Connect the phone, accept its RSA authorization prompt, and run `adb devices -l`.
3. Confirm the device status is `device`, then run `npm run android` from the feature worktree.
4. Start a known audiobook and note its position without recording its stream URL.

Current device: **Samsung Galaxy Z Fold6 (SM-F956B), connected over ADB.**

Current status: **long single-file resume and notification controls verified on
device; remaining rows below are intentionally left pending until exercised.**

## Long single-file audiobook

| Scenario | Expected result | Result |
|---|---|---|
| Start and play for at least 20 seconds | Position advances and checkpoints | PASS — position advanced beyond 12h 41m and remained nonzero in the Android media session |
| Background and foreground | Playback and position remain continuous | Pending |
| Notification controls | Rewind, play/pause, fast-forward all work | PASS — all three controls exercised from the pull-down notification; playback resumed successfully |
| Lock-screen controls | Rewind, play/pause, fast-forward all work | PASS — all three controls exercised successfully on the physical device |
| Drag notification progress | Playback seeks to selected position | Pending |
| Close and reopen app | Loads paused five seconds before durable position | PASS — correct book restored near 12h 41m, approximately eight seconds behind the last observed live position (checkpoint timing plus rewind window), never at the beginning |
| React reload while native session lives | Queue and position are adopted without a reset | Pending |
| Force-stop and relaunch | Restores the latest Android-permitted checkpoint paused | PASS — release-candidate build restored 51,287,222 ms from a 51,293,262 ms pre-stop position (about six seconds rewind); in-app Play resumed correctly and repopulated Android metadata |
| Sleep timer | Pauses, clears timer, and saves position | Pending |

## Multipart audiobook

| Scenario | Expected result | Result |
|---|---|---|
| Resume in a middle part | Correct part and five-second-rewound position load | Pending |
| Previous/next chapter | Queue index changes and position checkpoints | Pending |
| End-of-track sleep | Pauses only on a genuine next-part transition | Pending |
| Final 15 seconds of non-final part | Book remains unfinished | Pending |
| Final queue completion | Book is marked finished | Pending |

## Recovery and accessories

| Scenario | Expected result | Result |
|---|---|---|
| Expired remote stream | Refreshes once and resumes exact position and intent | Pending |
| Failed refresh | Position remains saved and retry is available | Pending |
| Bluetooth/headset pause | Intent becomes paused and position checkpoints | Pending |
| Bluetooth/headset play | Intent becomes playing without rebuilding queue | Pending |
| Audio-becoming-noisy | Playback pauses and checkpoints | Pending |

## Media-session inspection

While playback is active, run:

```bash
adb shell dumpsys media_session
```

Confirm the BusTAudioBooks session reports speech content, a stable
`<book-id>:<track-index>` media ID, the correct active queue index, a nonzero
position, no playback error, and rewind/play-pause/fast-forward transport
actions. Record only those non-sensitive fields.

Verified on the current device: **PASS** while playing. The session reported
speech content, a one-item queue for the chapterless book, correct metadata, a
nonzero position, no playback error, and rewind/play-pause/fast-forward actions.

Observation: immediately after a force-stop and cold relaunch, the app restored
the book and durable position in a paused state, but Android did not expose the
restored metadata or accept the system Play action until Play was tapped once in
the app. After that tap, the Android media session was fully populated and all
notification actions worked. This does not affect in-app cold resume, but remains
a media-session polish item rather than being recorded as a verified lock-screen
result.
