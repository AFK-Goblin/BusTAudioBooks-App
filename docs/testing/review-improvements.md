# Review improvements — first milestone

Branch: `codex/review-improvements`, based on `86c85f3`.

## Delivered scope

- Search ignores stale responses after a new query, clearing, pagination or unmount. Instant-only results stay filtered even when none match.
- New multipart downloads have unique filenames and durable completion evidence. Recovery verifies file sizes, preserves finished offline copies, and keeps legacy destinations compatible. Waiting items remain queued until a download is durably accepted.
- Playback initialization can retry after a transient failure without duplicate listeners. Startup recovery notices support retry and dismissal.
- The player keeps transport controls outside the scrolling content, opens chapters and bookmarks in separate sheets, and describes seeking to accessibility services.
- Long current chapter titles, chapter/part rows and Up next titles scroll slowly when they overflow, pausing at both ends. Short titles remain still. Changing titles or screen width resets motion; closing the sheet or backgrounding stops it. Reduce Motion, screen readers and RTL layouts receive wrapped full titles. Multipart playback shows the current part title when available.
- Library views separate All, Downloaded, Want to Listen and Transfers. Downloaded includes retained finished books. Transfer messages use real preparing/downloading/error states.
- Book synopsis appears before technical edition details. Settings has section shortcuts and a connection test. Setup copy and keyboard handling are clearer. Notification permission remains contextual.
- Shared controls have larger targets and white text uses accessible accent button colours.

## Verification

Automated coverage includes stale search requests, interrupted/duplicate download recovery, waiting acceptance failures, player retry and subscription cleanup, startup warning retries, focused library views, chapter/bookmark access, connection testing, and title animation overflow/reset/accessibility/background lifecycle.

Final checks: 46 Jest suites / 315 tests passed; TypeScript checking passed; lint reported 0 errors and 4 existing warnings; Android JavaScript export passed. Android export uses `--no-bytecode`: this validates bundling, not a native APK or Hermes compilation. The available host cannot run the installed x86 Hermes compiler or an Android emulator.

Expo doctor passed 20 of 21 checks. Its remaining check reports existing Expo/React Native patch-version mismatches in the unchanged dependency manifest. Dependency updates and native/runtime version changes are outside this milestone. Lint has four pre-existing effect warnings and no errors.

Independent combined review identified finished offline books missing from the Downloaded view. A failing regression reproduced it, and the view now includes those books without adding duplicate shelves.

## Required device checks before release

1. On compact Android screens and large system fonts, confirm transport controls, sheets, keyboard, safe areas and mini-player remain usable. Check TalkBack labels, full-title reading, sheet dismissal and focus.
2. Play an audiobook with long embedded chapter and part names. Confirm titles reveal their entire ending, pause and restart smoothly; short titles stay still. Open/close the chapter list, rotate, change font scale and toggle Reduce Motion/TalkBack. Verify no motion while backgrounded. Check a large chapter list for smooth scrolling.
3. Interrupt multipart downloads, terminate/relaunch the process, resume on Wi-Fi/mobile transitions, and cancel during startup. Verify existing offline books stay intact and only verified parts are reused. Exercise legacy jobs.
4. Simulate initial native player setup failure, retry, and confirm a live queue is preserved. Check lock-screen controls, Android Auto and notification permission timing.
5. Perform a native Android release build and device install before publishing; no deployment or app-store release was performed here.

## Follow-up roadmap

Collections, queue, file-based backup, live themes, sync, local import and richer backend discovery remain separate milestones. Existing settings section shortcuts are navigation aids within the current page, not separate settings pages.
