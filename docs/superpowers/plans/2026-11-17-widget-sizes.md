# Multiple widget sizes

Implement inline in the existing review-improvements worktree. User requested 1×4, 4×1 and useful additional sizes, preserving 2×3. Existing delegation covers implementation and signed APK delivery.

Five picker presets: column 1×4, bar 4×1, square 2×2, cover 2×3, wide 4×2. Preserve the existing provider as 2×3 so placed widgets survive upgrades. Four thin provider subclasses share rendering, state and actions. Each preset has sensible initial/minimum geometry; no global 1×1 minimum that would squash controls into unsupported space.

Rendering selects a layout by actual width/height. Android 12+ uses exact launcher-reported sizes; older launchers receive separate portrait/landscape views. Missing dimensions fall back to the selected preset. Column controls stack vertically; bar controls sit beside cover/title; square reduces secondary text; existing compact/wide layouts remain available. Layout selection is independent per widget and orientation.

All providers share the existing player. Snapshot presence checks and native widget ID lookup must include every preset. Removing the last instance of one preset must not clear shared state while another remains. No account, sync or progress ownership changes.

Tasks:
- [x] Failing native geometry-selection cases and Expo manifest registration regressions.
- [x] Pure layout selector, exact/legacy rendering, shared provider lifecycle; manifest registration, preset/layout resources; expand service snapshot presence check.
- [x] Verify dependency patch applies, regenerate Android, full tests/typecheck/lint/native API compile, independent review.
- [ ] Version/runtime3.3.2/code8; signed cloud build with native unit tests; validate APK signature, all five provider grids/resources; deliver installation instructions.

Device/launcher interaction testing unavailable here. Actual cell dimensions are launcher-specific; test representative portrait/landscape and narrow/short cases in policy and inspect resource geometry.

Verification before signing: 355 Jest tests / 49 suites passed; 16 native JUnit tests passed; TypeScript passed; lint zero errors and four unchanged React hook warnings. Native Kotlin compile against Android15/Media3 APIs passed with -Werror; Android prebuild passed. All five layouts contain each shared view binding exactly once, and all five providers appear in generated manifest. Service dependency patch reverse/application round trip verified.

Independent review found a dense-grid issue: row selected square at232×50dp and required250dp width. Regression reproduced then passed after row minimum/selection width dropped to200dp; covers are hidden below230dp in the bar to leave title room. Important lifecycle/snapshot/rotation checks passed source review. No physical launcher, accessibility or in-place installation validation available here.

Earlier 2×3-only build 40793b6a-92d2-4699-beb8-cda4a51496ea is FINISHED (3.3.1/code7) and superseded by this expanded3.3.2/code8 release.

Follow-up review identified row visibility reapplication: Android can reuse a row view after resizing. The renderer now explicitly sets both visible/hidden outcomes for cover and chapter on every render so stale visibility cannot survive narrowing/widening or shortening/tallening.
