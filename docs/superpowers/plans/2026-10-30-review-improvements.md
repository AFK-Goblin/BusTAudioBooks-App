# Review Improvements Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement the tasks below. The user approved starting the review recommendations and delegated sequencing.

**Goal:** Complete the first review milestone: reliable search, offline download integrity, retryable playback startup, accessible player controls, and clearer library/setup/settings flows.

**Architecture:** Retain the existing durable playback owner, library storage, download adapter, and screen navigation. Add small focused helpers where state coordination is needed; preserve legacy download jobs and completed library entries. Make all changes with current native dependencies.

**Tech Stack:** Expo 57, React Native, JavaScript/TypeScript, Jest and React Native Testing Library.

**Spec:** `/workspace/BusTAudioBooks/BusTAudioBook-App-Review.md`, recommendations 1–9. Collections, queue, file backup, live themes, sync, import and richer backend discovery remain follow-up milestones.

## Global Constraints

- Preserve saved listening positions, bookmarks, completed downloads and existing settings.
- No new native modules; keep app.json version/runtimeVersion at 3.2.0.
- No publishing, deployment, remote push, or production service changes.
- Keep the existing dark visual identity and current navigation.
- New interactive targets are at least 48dp; use readable solid accent surfaces.
- No fabricated connectivity, completion or retry-success states.
- Regression tests must fail before substantive behavior fixes; purely visual edits use targeted layout inspection and existing screen checks.
- Agents own disjoint files; they do not commit or edit another task's files. Parent commits coherent changes after review.

## Review Focus

- Old search and pagination responses after a new query or clear must not restore stale results.
- Interrupted multipart downloads must not accept unverified partial files or collide on filenames; legacy jobs remain resumable.
- Download startup persistence failure or duplicate start must not lose waiting entries or report success.
- Failed initial native setup must be retryable without duplicate subscriptions or resetting a healthy live session.
- Compact screens, large fonts and a visible mini-player must leave core actions reachable and meaningful states discoverable.

### Task 1: Search correctness

**Files:** `screens/SearchScreen.js`; new `src/__tests__/searchBehavior.test.js` (use current screen test patterns without editing shared screens.test.js).

**Interfaces:** Keep `search(query, page)` and navigation unchanged. Track current request generation across submit, pagination, clear and unmount; guard all UI/cache writes from stale requests. Instant-only always filters cached results.

- [x] Add failing behavior tests for older query resolving last, old pagination resolving after a new query, clearing during a request, and Instant-only with zero cached items.
- [x] Run targeted tests and capture expected failures.
- [x] Implement generation protection and a clear-filters empty action. Keep existing results and search history behavior.
- [x] Run targeted and existing screen tests; report changed files and evidence.

### Task 2: Download integrity and waiting handoff

**Files:** `src/downloads.js`, `src/downloadStore.js`, `src/downloads/adapter.ts` if needed, `src/waiting.js`, relevant download/waiting tests. Do not edit screens.

**Interfaces:** Keep `downloadBook` resolving on full completion. `startDownload(book, files)` should return a promise resolving only after durable acceptance (not download completion), rejecting early failures; existing callers must be audited for handled rejection. Expose a separate enqueue helper if safer for compatibility. Waiting entries disappear only after accepted persistence. Communicate chosen interface to parent before integration.

- [x] Add failing tests for partial/nonempty recovered file, validated finished part reuse, unknown-size recovery, colliding sanitized names, legacy destination compatibility, job storage failure and duplicate concurrent starts.
- [x] Add failing waiting test: rejected durable acceptance keeps the item visible and does not toast success.
- [x] Implement unique per-part destinations for new jobs with persisted naming version; retain legacy job handling. Track trustworthy completion evidence and verify file sizes where known; never trust nonzero size alone. Preserve canceled/failed file cleanup semantics.
- [x] Make queue acceptance durable and observable; keep actual downloading asynchronous. Expose truthful preparing/downloading states via the existing store as needed. Do not infer network type without evidence.
- [x] Run download/waiting suites and report API decisions.

### Task 3: Retryable player initialization

**Files:** `src/playback/session.ts`, `src/playback/nativePlayer.ts` if needed, related playback tests. Do not edit App.js or screens.

**Interfaces:** `initialize(): Promise<PlaybackSnapshot>` shares an in-flight attempt and clears a rejected attempt, preserving successful initialization reuse. Parent consumes startup warnings in App.js and invokes existing `setupPlayer()` for retry.

- [x] Add failing tests: transient setup rejection followed by successful retry; concurrent callers share one attempt; retry after a later initialization-stage failure does not duplicate listeners; successful live-session adoption remains unchanged.
- [x] Implement minimal recovery and useful error state without clearing a valid live queue unnecessarily.
- [x] Run playback suites and typecheck; report retry behavior to parent.

### Task 4: Player, accessibility and product flow polish

**Files:** `screens/PlayerScreen.js`, `screens/LibraryScreen.js`, `screens/BookScreen.js`, `screens/SetupScreen.js`, `screens/SettingsScreen.js`, `App.js`, `src/theme.js`, `src/ui.js`, `src/layout.js`, targeted UI tests.

**Interfaces:** Keep existing player commands and settings keys. Read real download store status, with honest preparing fallback. Maintain explicit contextual notification prompts. Startup warnings produce a dismissible retry action wired to setupPlayer/resumePendingDownloads as appropriate.

- [x] Add tests for explicit Chapters/Bookmarks access, seek accessibility metadata, new library view filters, connection retry and startup retry where practical.
- [x] Size cover from width and usable height/font scale; keep core transport visible outside optional long lists. Move bookmarks into their own sheet; retain editing, sharing, long-press bookmark and jump undo.
- [x] Increase undersized transport/shared targets to 48dp, name icon-only actions, and choose accent button colours passing contrast with white text. Preserve accent identity for links/decoration.
- [x] Add Library view chips for All, Downloaded, Want to Listen and Downloads (waiting/active/errors), with useful empty actions. Remove false Wi-Fi inference and use actual download states.
- [x] Put synopsis directly after primary book actions; move technical metadata to an Edition details block.
- [x] Add settings section navigation and Test Connection; improve setup instructions and keyboard handling. Remove the unsolicited startup notification prompt while preserving contextual permission requests.
- [x] Run focused UI tests and inspect resulting layout source for compact/large-font behavior.

### Task 5: Review and delivery

**Files:** documentation, test matrix, and any fixes required by review.

- [x] Run complete Jest suite, lint, typecheck, Expo doctor, and Android export with a host-compatible compiler when available.
- [x] Obtain independent review of all changed code, fix substantive findings, and rerun affected checks.
- [x] Record completed scope and device-only checks without claiming native visual verification.
- [x] Commit the local feature branch and deliver its location, validation and remaining roadmap. Do not publish.

## Additional user request — long chapter titles (2 November 2026)

Use the current React Native stack, with no extra dependency. Overflowing current, next, chapter and part titles scroll at a steady speed after a pause, retain the full accessible label, and reset on title/width changes. Reduce Motion, screen readers and RTL use wrapped text. Backgrounding stops animation; chapter rows are mounted only while their sheet is open. Short titles do not animate. The user delegated implementation choices and explicitly requested this addition.

Regression coverage: overflow versus fitting text, end position, title changes, resizing, unmount, accessibility preferences, foreground lifecycle, and multipart title visibility. Native visual QA remains required.
