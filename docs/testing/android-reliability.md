# Android reinstall and streaming reliability

Reported on a Samsung Galaxy Z Fold6 with Words of Radiance: re-downloading after reinstall gets stuck, a generic background download notification remains, and streamed audio starts before the app closes, possibly with the screen off. Android version and device crash logs are unavailable.

## Changes

- Verify restored offline file paths and sizes before download reuse, playback restoration, and book/library display. Missing or truncated copies lose only their device-download metadata; progress, bookmarks, saved state and account information remain.
- Compare the inspected download snapshot under the library write lock before clearing it, preserving a newer concurrent download. Storage inspection errors leave metadata intact and offer a retry on the book screen.
- Disable RNTP 5.8's whole-next-part preload while retaining on-demand disk caching. Its native implementation uses an unbounded preload duration for a positive preload window.
- Validate chapter HTTP ranges and lengths, read bounded chunks, and cancel malformed, oversized or truncated responses. Never collect an arbitrary response with arrayBuffer().

The restored-download failure was reproduced in tests. The streaming changes reduce resource risks; they do not establish the cause of the reported native crash or prove that the generic notification issue is resolved.

## Verification

- Download regressions: four tests failed before implementation, then passed.
- Streaming/config regressions: ten assertions failed before implementation, then passed.
- Fresh read-only review found one storage-error UI issue. A new regression failed first, then passed after correction.
- Full Jest: 50 suites, 373 tests passed.
- TypeScript: passed. ESLint: zero errors, four existing effect warnings.
- Android production export and Hermes bytecode compilation: passed with the existing ARM64 QEMU compiler wrapper.
- No native module, runtime, or version changes; compatible with Android runtime 3.3.2.

## Device follow-up

After the OTA reload, cancel the old failed job if it remains, open the book and retry its download. Confirm the book title and progress appear in the app. Stream Words of Radiance with the screen on, then locked for several minutes. A persistent app exit needs an Android crash log to distinguish process termination, native playback failure and Samsung background restrictions. Do not uninstall or clear app data to apply this update.
