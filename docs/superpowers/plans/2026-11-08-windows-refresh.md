# Windows Refresh Implementation Plan

> **For agentic workers:** Use executing-plans for updater work; independent renderer work may run through dispatching-parallel-agents.

**Goal:** Deliver a polished Windows 1.1.0 with phone-matched appearance and automatic installed-app updates.
**Architecture:** Keep Electron main/preload security boundary. Testable updater coordinator wraps electron-updater; NSIS and GitHub release metadata supply updates. Renderer remains vanilla DOM/CSS.
**Tech Stack:** Electron 45.2.3, electron-builder 26.18.0, electron-updater 6.8.11, Node tests, Playwright.
**Spec:** docs/superpowers/specs/2026-11-08-windows-refresh-design.md

## Constraints and review focus
- Preserve the existing Electron userData path, private account state, playback checkpoint/conflict semantics.
- No update before verified download, no restart with unsaved recoveries, no auto-install on quit.
- Concurrent check requests share work; network failure remains retryable; unsupported packages truthful.
- Theme persists independently of sign-out. No credentials in renderer/update requests.
- Long titles, small windows, reduced motion and keyboard focus remain usable.

## Tasks
- [x] Updater: failing tests in desktop/test/updates.test.cjs for unsupported mode, background/manual checks, concurrent checking, downloaded transition, errors/retry, recovery-blocked restart. Implement desktop/updates.cjs with createUpdates({updater,enabled,version,onStatus,canInstall,install}), methods snapshot/check/install; event-driven state. Integrate main/preload desktopInfo, setAccent, checkForUpdates, installUpdate, onUpdateStatus. Restart awaits renderer checkpoint; main rechecks recoveries.
- [x] Renderer (independent): desktop/ui app.js, styles.css, index.html; match phone palette, accent setting, polished shell/library/player, update card/banner. New API desktopInfo returns {version,accent,updates}; status phases disabled/idle/checking/downloading/ready/current/error/installing with version/percent/message. setAccent returns selected key; update methods return status. Existing browser fixtures may omit APIs. Add focused renderer regression test and capture screenshots; retain audio/race tests.
- [x] Distribution: pin dependencies, build NSIS and portable 1.1.0, package runtime dependencies, app-update.yml installed-only. Preserve existing userData. Add Windows release workflow with manual/tag trigger, build/tests, draft release assets; no embedded tokens. Verify installer artifacts and metadata hashes.
- [x] Validate/integrate: full desktop unit/browser suites, phone regression suite if shared files touched, lint, actual artifact checks, independent review, fix material findings. Commit and document release status and migration steps accurately.

## Ledger
- Design calls: standard NSIS, GitHub provider, local accent preferences, explicit restart. User already delegated implementation order in this session.

Release finding: this repository also publishes Android APK releases. Windows uses the isolated generic feed at releases/download/desktop-stable/, promoted only from published desktop-v* releases. Mobile releases cannot shadow Windows metadata. Package name and productName stay unchanged to preserve the actual existing userData path.

## Verified delivery — 2026-11-09

19 desktop unit tests pass; all four browser scripts pass, including real WAV playback, playback races, persisted accents, readable long titles at 920px, update status without player replacement, and restart checkpoint/recovery/playback locking. Lint has zero errors and four pre-existing React hook warnings; typecheck and git diff --check pass. npm audit reports zero vulnerabilities.

Independent review found an unhandled background downloadPromise rejection and a restart/playback race; both were reproduced by failing tests and fixed. Reviewer stopped at its usage limit, so remaining main-process/release integration was reviewed locally. Native Windows installation and an actual version upgrade still require Windows verification.

Installer and portable ZIP built. Installer extracted with 7-Zip: packaged main/preload/core/updater/UI sources exactly match working source; public feed is isolated to desktop-stable. Final installer manifest SHA-512 and size verified. Cached Electron ZIP SHA-256 verified against official GitHub release asset digest after GitHub SHASUMS download returned HTTP504. ARM NSIS build uses QEMU and upstream UninstallerReader; reproducible release workflow builds natively on Windows.

Installer: /workspace/BusTAudioBooks/BusTAudio-Setup-1.1.0-x64.exe (122194930 bytes), SHA-256 1b8739ac9eae86cce3f7ab10816b0103f020a49b5374ba95cfe5e29e01c6550e. Portable: /workspace/BusTAudioBooks/BusTAudio-1.1.0-windows-x64.zip (161993538 bytes), SHA-256 a6a14a27f87428323640545fd1e7319f7c0930ca735577ec9bc918546454c00b. Both remain unsigned, matching previous distribution.

- [ ] Publish live Windows update feed after repository write access is connected. GitHub plugin was suggested, not yet installed/connected. No remote branch push, release or update-feed publication has happened. Existing source branch/worktree retained for continuation.
