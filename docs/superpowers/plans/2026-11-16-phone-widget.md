# Android Listening Widget Implementation Plan

> Implement inline with executing-plans; one fresh review after integration.

**Goal:** Deliver an Android home-screen widget using the existing player.
**Architecture:** App RemoteViews provider and action Activity, explicit native playback snapshot broadcast, short-lived Media3 controller for user actions. Expo config plugin installs Android assets and dependencies.
**Tech Stack:** Kotlin, Android RemoteViews, Media3 1.9.2, Expo config plugin, JUnit and Jest.
**Spec:** ../specs/2026-11-16-phone-widget-design.md

## Constraints and review focus
- Preserve package identity, progress ownership and private accounts.
- Dead or empty service opens the app; no stale playback reconstruction.
- Old widget controls must not seek a newly selected book.
- Unknown duration, long titles and failed artwork remain usable.
- No persistent widget polling/controller, no work when no widgets exist.
- New runtime/APK needed; never publish native calls to runtime 3.2.0.

## Tasks
- [x] Native widget: `plugins/android-widget/` Kotlin provider, state/action policy, transient action Activity, resources and JUnit tests. Red/green native policy cases cover paused/buffering/dead player, stale book, seek clamping and unknown duration. Render multiple widgets consistently and fetch bounded cached artwork off main thread.
- [x] Integration: `plugins/withListeningWidget.js` manifest, Gradle and asset generation with repeatability tests; service snapshot hook in existing RNTP patch; increment app/runtime and Android versionCode after checking latest cloud build. Readonly snapshots only, commands use existing native player.
- [ ] Verification/delivery: run full mobile Jest, lint/typecheck, generated Android config inspection, cloud Gradle unit tests and signed APK build; independent review; fix important findings; record exact artifact, install instructions and limits.

## Ledger
- Scope defaults follow existing session delegation. No extra design approval requested.

## Local delivery status

Native layout/provider/controller/activity and integration are implemented. Native policy regression initially failed and passed after the implementation. Fresh review found the action-only PendingIntent token could be reused across books; regression reproduced that failure and the fix includes encoded mediaId in token identity.

No Android device/emulator was available. Local Kotlin compilation uses real Android 15 and Media3 1.9.2 APIs with temporary R symbols derived from the XML; this is not an APK build or a resource-linking/device test. Generated manifest and Gradle integration are inspected and regression-tested. Native service patch reverse/application verified.

Final review: independent widget_review. Important stale PendingIntent identity issue fixed with a failing-then-passing behavioral test. Minor (deferred): thumbnail reads have per-read timeout and byte/decode bounds but no overall download deadline/cancellation; a slow cover server can keep an obsolete worker alive.

Review limitations: physical launcher/accessibility and tap behavior, Android resource packaging, and signed upgrade preserving installed data require actual build/device validation. They are outstanding verification, not assumed successes.

Cloud build blocked: automatic approval review rejected submission to Expo because source upload and use of existing signing credentials require explicit user approval. No source was uploaded and no widget APK was produced. The concrete pending action is eas build --platform android --profile preview-widget --non-interactive --no-wait. This profile runs :app:testReleaseUnitTest before :app:assembleRelease using runtime3.3.0, package com.bustaudio.app, versionCode6.

Final checks: 354 Jest tests / 49 suites pass; 14 native JUnit tests pass; all five native Kotlin files compile with -Werror against Android15 / Media3 1.9.2; TypeScript passes. Lint runner global declaration corrected; existing four React hook warnings remain.
