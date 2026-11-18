# Multiple widget sizes

Implement inline in the existing review-improvements worktree. User requested 1×4, 4×1 and useful additional sizes, preserving 2×3. Existing delegation covers implementation and signed APK delivery.

Five picker presets: column 1×4, bar 4×1, square 2×2, cover 2×3, wide 4×2. Preserve the existing provider as 2×3 so placed widgets survive upgrades. Four thin provider subclasses share rendering, state and actions. Each preset has sensible initial/minimum geometry; no global 1×1 minimum that would squash controls into unsupported space.

Rendering selects a layout by actual width/height. Android 12+ uses exact launcher-reported sizes; older launchers receive separate portrait/landscape views. Missing dimensions fall back to the selected preset. Column controls stack vertically; bar controls sit beside cover/title; square reduces secondary text; existing compact/wide layouts remain available. Layout selection is independent per widget and orientation.

All providers share the existing player. Snapshot presence checks and native widget ID lookup must include every preset. Removing the last instance of one preset must not clear shared state while another remains. No account, sync or progress ownership changes.

Tasks:
- [x] Failing native geometry-selection cases and Expo manifest registration regressions.
- [x] Pure layout selector, exact/legacy rendering, shared provider lifecycle; manifest registration, preset/layout resources; expand service snapshot presence check.
- [x] Verify dependency patch applies, regenerate Android, full tests/typecheck/lint/native API compile, independent review.
- [x] Version/runtime3.3.2/code8; signed cloud build with native unit tests; validate APK signature and all five provider grids/resources. Installation guidance is included in RELEASE-NOTES.md; GitHub publication is pending authentication.

Device/launcher interaction testing unavailable here. Actual cell dimensions are launcher-specific; test representative portrait/landscape and narrow/short cases in policy and inspect resource geometry.

Verification before signing: 355 Jest tests / 49 suites passed; 16 native JUnit tests passed; TypeScript passed; lint zero errors and four unchanged React hook warnings. Native Kotlin compile against Android15/Media3 APIs passed with -Werror; Android prebuild passed. All five layouts contain each shared view binding exactly once, and all five providers appear in generated manifest. Service dependency patch reverse/application round trip verified.

Independent review found a dense-grid issue: row selected square at232×50dp and required250dp width. Regression reproduced then passed after row minimum/selection width dropped to200dp; covers are hidden below230dp in the bar to leave title room. Important lifecycle/snapshot/rotation checks passed source review. No physical launcher, accessibility or in-place installation validation available here.

Earlier 2×3-only build 40793b6a-92d2-4699-beb8-cda4a51496ea is FINISHED (3.3.1/code7) and superseded by this expanded3.3.2/code8 release.

Follow-up review identified row visibility reapplication: Android can reuse a row view after resizing. The renderer now explicitly sets both visible/hidden outcomes for cover and chapter on every render so stale visibility cannot survive narrowing/widening or shortening/tallening.

Delivery status: the user subsequently authorized upload and signing. EAS build `87eb6441-a454-4477-be94-43564faad160` finished successfully from source commit `5788ae9a8ec3ab9c7b011b750927c4c74bff7f1d`, using profile `preview-widget`. Cloud logs confirm release Kotlin compilation, release unit tests and release APK assembly passed.

APK: https://expo.dev/artifacts/eas/mqUPTq9yJbhdGtwLRFION2eQeFQiOCk7_MzJJb7gjfE.apk

Downloaded artifact: `BusTAudioBooks-3.3.2-widgets.apk`, 89,650,198 bytes. SHA-256: `845dd0959901d44e0f4f72efb650544a64ca1cd81a263ee42750d8f7c6397906`.

APK signature verified against existing signer SHA-256 `304e43a5112692bfb69b2fa652a8c14f0d40efc948cb06e983098de9d19e92ea`. Packaged manifest confirms `com.bustaudio.app`, version 3.3.2/code 8, and all five widget receivers. Binary resource inspection confirms grids 1×4, 2×2, 2×3, 4×1 and 4×2, all five layouts and all five provider classes. Physical installation and launcher interaction remain untested.

Release preparation: fetched origin/main at `86c85f3`; all 355 mobile tests and 19 desktop unit tests passed again. TypeScript passed. The v3.3.2 GitHub release and live server recommendation still require publication/verification; preparing the artifact does not mean they are live.
