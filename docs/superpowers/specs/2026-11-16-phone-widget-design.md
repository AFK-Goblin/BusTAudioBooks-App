# Android listening widget

User requested a phone widget after being offered cover, chapter, progress, play/pause and skip controls. Existing session delegates implementation choices. Use the current isolated worktree and implement inline.

Provide one resizable 4×2 home-screen widget in the existing plum/purple theme. Show cover, two-line book title, two-line chapter/part, current-part progress, play/pause and skip back/forward using the player's configured intervals. Cover/title opens BusTAudio. No library/account credentials are stored by the widget.

Approaches: a shortcut cannot provide live controls; a JS-driven widget adds a headless runtime and another playback command path; a native RemoteViews widget can observe the existing Media3 session. Choose native RemoteViews with the existing service, no second audio player. This is an implementation default, not a user-selected library.

The service sends explicit, app-private snapshot broadcasts on native player changes and existing five-second progress ticks, only if widgets exist. The app widget stores only display metadata in private preferences and downloads a bounded cover thumbnail on a worker. Widget actions use an explicit transparent Activity and a temporary Media3 controller: existing media plays/seeks through the service's existing command handling. If there is no loaded queue, open the app to restore rather than inventing a queue from stale widget metadata. Stale controls for a different book do not seek the new book. PendingIntents are immutable. Do not keep a controller or timer running solely for the widget.

Empty state says to open BusTAudio and choose a book. Service shutdown marks the widget paused/unavailable; removing the last widget clears its thumbnail and display cache. Readable long titles take priority over fixed one-line text; no scrolling animation dependency in RemoteViews. Cover failure uses a bundled icon.

Delivery requires a new signed APK/runtime, preserving package identity and existing user data. Test native state/action policies, config plugin repeatability, full phone regression suite, generated Android build and packaged widget components. A physical launcher/device check remains explicit if no device is available.
