# Android reinstall and streaming reliability

User reports Words of Radiance download stuck after reinstall, generic Background Download notification for 30 minutes, and streaming audio starts then app closes, possibly on screen-off. Phone: Samsung Galaxy Z Fold6; Android version unavailable. No crash log or attached phone is available; do not claim a reproduced native crash.

Implement inline in the isolated fix/android-reinstall-streaming worktree. Preserve progress, bookmarks and accounts. Do not wipe storage or migrate native dependencies.

1. Reproduce stale restored download flags with disk-backed test fixtures. Validate local files before treating a book as downloaded. Repair missing/truncated copies at startup, on book entry and before new downloads. Compare the checked file snapshot inside the library write lock so concurrent replacement cannot be erased. Failed filesystem inspection preserves metadata and surfaces an error.
2. Disable RNTP's optional whole-next-part preload (native implementation uses Long.MAX_VALUE). Keep on-demand playback and disk caching. Bound streamed chapter responses by the requested range and bytes read; reject malformed or oversized responses without buffering arbitrary bodies. These mitigate memory risks, but do not prove the reported phone crash's cause.
3. Run regression suites, full Jest, typecheck/lint and Android JS export. One unchanged baseline screen test timed out on first full run and passed unchanged on isolated rerun. Review the final change and prepare a compatible JavaScript update if verification succeeds; no native version bump for these fixes.

Review focus: valid offline copies survive; missing/truncated files lose only device-download metadata; filesystem failures do not erase data; concurrent download replacement is preserved; streamed range rejection cancels the body; the player's next-part cache preload is off while audio continues normally.

Execution complete: recovery tests RED→GREEN; streamed range/preload tests RED→GREEN; final review storage-error finding RED→GREEN. Final verification: 373 tests / 50 suites, typecheck, lint (four existing warnings), production Hermes export passed. Physical screen-off crash reproduction remains unavailable. Publish a compatible preview-channel update for runtime 3.3.2 under the established update authorization.
