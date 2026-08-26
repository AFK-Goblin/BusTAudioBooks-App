# BusTAudio 3.0 foundation release checklist

This release changes the Expo/React Native runtime and native playback/download libraries. It requires a new APK; do not publish its JavaScript to the 2.x runtime.

## Automated gates

- `npm ci`
- `npm run lint` (zero errors; legacy warnings are tracked polish debt)
- `npm run typecheck`
- `npm test`
- `npm run doctor`
- `npm run export:android`
- Install a signed release APK and confirm it opens without Metro.

## Upgrade scenarios

- Clean install: connect a server, play a book, background the app, and verify notification/lock-screen play, pause, seek, ± skip, next and previous.
- Audiobook-only 2.x upgrade: library, progress, bookmarks, local downloads, speed and jump intervals survive. Comics remains disabled.
- Upgrade with comic history: existing comic data survives and Comics is initially enabled. Disable it in Settings and confirm only its navigation disappears; re-enable it and confirm the data returns.
- Active download upgrade: start a multi-file download on 2.x, install 3.0 without clearing data, and verify the same native task IDs reattach and finish. Failure is a release blocker.
- Failed/paused download: reopen the app, retry or resume, then verify only one file/task is created and progress is credible.
- Offline first launch after upgrade: migration completes, downloaded books open, and network failures do not erase cached data.
- Process death: play and download, swipe the UI away, reopen it, and confirm native playback/download state is reconstructed without duplicate setup.
- Finished auto-delete: downloaded media is removed while listening history and progress remain.
- Error recovery: force a development render error, use Restart app view, and verify Share diagnostics contains no install-token path, URL query, authorization value, or private file path.

## Storage and privacy inspection

- Inspect AsyncStorage after migration: `bustaudio_migration_backup_v1` may contain legacy library/settings/download jobs, but must not contain SecureStore values or the install link credential.
- Confirm `bustaudio_migration_marker` is written last and a second launch does not rewrite migrated records.
- Confirm corrupt records are preserved for diagnosis and surfaced as recoverable warnings rather than overwritten with defaults.

## Rollback

- Keep the prior signed APK and backend version available until the populated-upgrade matrix passes.
- Because 3.0 writes versioned keys and retains legacy values, reinstalling 2.x should still see its legacy library. Downloads created by the new native downloader are not guaranteed to reattach in 2.x.
- Never clear application data as part of an APK rollback unless the user explicitly accepts losing local progress and downloads.
