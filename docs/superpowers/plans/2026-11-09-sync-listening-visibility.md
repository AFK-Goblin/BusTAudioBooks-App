# Synced listening visibility

User reports a book disappearing from Also listening to and Continue Listening after syncing Windows progress to the phone. They confirmed the book remains in Downloads and the progress arrived, then resumed listening before the exact part/position could be checked. The precise device-side cause remains unconfirmed.

Reproduced a concrete matching failure: syncing part index 4 at 0, 3 or 5 seconds retains the book and progress but removes it from both listening lists. The shared list filter only considered position within the current part, while Want to Listen already considered later parts as started. Thus a saved book could be excluded from both shelves. Sync counts had the same omission.

Source commit: 5ae37c83e13045d3e3787549289ed536f8c1c38d. Reuse isStarted for the listening filter, keep finished books excluded, and include later parts in account progress counts. Clarify that manual sync sends and receives progress. No account data, sync conflict resolution, or playback positions were changed.

Verification: four new regression cases failed before the change and pass afterward. Full mobile suite: 347 tests across 48 suites pass. Real SQLite HTTP phone → desktop → phone contract passes. Typecheck passes; lint has zero errors and four existing React hook warnings. Android export succeeds, genuine Hermes v98 bytecode verified.

Published Android preview update, runtime 3.2.0:
- Group: 3926dd0f-3b45-4782-adb3-796116761cb9
- Update: 01a1bb54-a4b9-7bd0-afff-475fa1d97c61
- Message: Keep synced books visible at the start of later parts; clarify two-way sync

If the symptom persists after installing the update, obtain actual part/position/finished status before changing synchronization or overwriting any progress.
