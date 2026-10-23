# BusTAudio — Android app

An Expo/React Native audiobook app for the [BusTAudio backend](#related-projects): search,
**stream**, **offline download**, background playback with lock-screen controls,
chapters, bookmarks, a sleep timer, and **Continue Listening** with saved progress.

It talks to your server's `/app` API. Users configure it once by pasting their
BusTAudio install link (the same link they'd use in Stremio).

## Features

- **Listening:** streaming or offline downloads (native background downloader;
  resumes after the app is killed), real chapters for M4B/M4A and MP3 books
  (read from the files' own markers), whole-book time left, speed per book
  (0.5–3.5×), sleep timer (fade-out, end of chapter, bedtime auto-timer), smart
  rewind, undo for accidental jumps, "go to time", car mode, bookmarks with
  notes, and lock-screen / headset controls.
- **Android Auto:** downloaded books on the car's screen; picking one resumes it.
- **Library:** Continue Listening, Want to Listen, Downloads and Finished, as a
  list or a cover grid, with sort, filter, foldable sections, ratings and a page
  of every bookmark. "Download when ready" fetches books TorBox is still caching.
- **Discovery:** the series a book belongs to and what comes next, new and
  upcoming books in your series, and "Because you listened to…" suggestions
  (from Audible's public catalogue, via the server).
- **Your listening:** daily stats, streaks, an optional daily goal, time per book.
- **Notifications** (optional): a book is ready on TorBox, or a new book in a
  series you're listening to is out — checked in the background.
- **Settings:** accent colours, skip intervals, Wi-Fi-only downloads, storage
  manager, backup & restore as plain text, update checks.
- **Updates:** JavaScript changes ship over the air with `eas update`; native
  changes ship as a new APK announced through the server's `/app/version`.

> ⚠️ **Release rule:** `app.json`'s `runtimeVersion` is pinned to the literal
> `"3.2.0"` (the native runtime of the current APK) so JS-only
> releases OTA to existing installs. If a release adds/changes ANY native
> module or bumps the Expo SDK, you MUST bump `runtimeVersion` (e.g. to
> `"3.3.0"`), build + distribute a new APK, and set `APP_LATEST_VERSION` /
> `APP_APK_URL` on the server — publishing native-dependent JS against the old
> runtimeVersion would hard-crash every OTA'd install.

## What you need (on your PC)

- **Node.js** (already installed from the addon setup).
- A free **Expo account** — sign up at https://expo.dev.
- The **EAS CLI**: `npm install -g eas-cli`

No Android Studio needed — the APK is built on Expo's servers.

## Build the APK

From inside this folder:

```bash
npm install
npx expo install --fix        # aligns versions to the installed Expo SDK
eas login                     # your expo.dev account
eas build -p android --profile preview
```

The last command uploads the project, builds in the cloud, and prints a URL to
**download the APK**. Share that URL (or the .apk) with your users. To install on
a phone, they tap the APK and allow "install from unknown sources."

> The player library (`@rntp/player`) needs React Native's New Architecture,
> which is the default; `patches/` holds a small fix to it that `npm install`
> applies automatically (patch-package).

## Ship an update

**JS-only changes** (screens, logic, styling — no new native modules, no
`app.json` native config changes, no `version` bump):

```bash
eas update --channel preview -m "what changed"
```

Installed apps fetch it on next launch/foreground and show a "Reload" banner.

> Publishing from an ARM64 Linux machine: the Hermes compiler that `eas update`
> runs is an x86-64 binary. Point `REACT_NATIVE_OVERRIDE_HERMES_DIR` at a folder
> whose `build/bin/hermesc` runs it through `qemu-x86_64-static`.

**Native changes** (new native dependency, `app.json` native config, version
bump): build a new APK with `eas build`, host it, and point the backend's
`/app/version` response at it — installed apps will show a download banner.

> ⚠️ `runtimeVersion` follows `version` in `app.json`: bumping the version cuts
> older installs off from OTA updates, so only bump it together with a new APK.

## Using the app

1. On first launch it asks for your **install link** — the `https://…/…/manifest.json`
   link from your server's `/configure` page. Paste it, tap Connect.
2. **Search** → tap a book → **Stream now** or **Download for offline**.
3. **Library** holds Continue Listening, Want to Listen, Downloads and Finished books.
4. **Android Auto** lists apps installed outside the Play Store only after you
   allow it once: Android Auto settings → tap **Version** ten times → ⋮ →
   **Developer settings** → **Unknown sources**.

## How it maps to the backend

- Search → `GET /<config>/app/search?q=…&page=…`
- Play/Download → `GET /<config>/app/streams/<id>` → TorBox HTTPS file link(s)
- Book page → `GET /<config>/app/details/<id>` (synopsis, genre, year)
- Series → `GET /<config>/app/series/<id>`; suggestions → `GET /<config>/app/similar/<id>`
- Update check → `GET /<config>/app/version` → `{ latestVersion, apkUrl }`
- The install link's config blob carries the user's TorBox key + access token,
  so each user streams from their own TorBox account through your shared Jackett.
  The key is stored only on-device (SecureStore) and never shown in the UI.

## Project layout

| File | Purpose |
|------|---------|
| `index.js` | Entry: registers the app + background playback service |
| `service.js` | Lock-screen / notification control handlers |
| `App.js` | Navigation stack + tabs, back handling, update banners, mini-player, boot |
| `src/config.js` | Parse + store the install link |
| `src/api.js` | Backend `/app` client |
| `src/player.js` | Compatibility facade for existing screens; delegates all commands to the durable session |
| `src/playback/session.ts` | Sole owner of the native queue, restoration, checkpoints, sleep, and stream recovery |
| `src/playback/runtime.ts` | Connects the session to TrackPlayer, settings, library, API, and durable repositories |
| `src/playback/progressModel.ts` | Queue identity, finished detection, whole-book progress estimates |
| `src/chapters/` | Embedded-chapter readers (`mp4.ts`: MP4 box walker; `id3.ts`: ID3v2 CHAP) over HTTP Range or local reads, per-book cache, navigation, lock-screen titles |
| `src/downloads.js` | Background downloads, resume-after-kill, storage management, orphaned-folder sweep |
| `src/downloadStore.js` | Observable in-progress download state |
| `src/waiting.js` | "Download when ready": books waiting on TorBox |
| `src/library.js` | Local library: progress, downloads, finished, saved, ratings, bookmarks |
| `src/series.js` / `src/releaseAlerts.js` | Series, next books, suggestions; new-release alerts |
| `src/stats.js` | Listening time per day and per book |
| `src/backgroundCheck.js` / `src/notify.js` | The background check and its notifications |
| `src/playback/carBrowse.ts` | What Android Auto lists |
| `src/backup.js` | Backup & restore as plain text |
| `src/settings.js` | Persisted user settings store |
| `src/theme.js` / `src/ui.js` / `src/icons.js` | Theme (accent colours), shared UI, view-drawn icons |
| `src/layout.js` | Status-bar/tab-bar metrics |
| `screens/*` | Setup, Home (search), Book, Player, Car, Library, Bookmarks, Stats, Settings |
| `plugins/withAndroidAuto.js` | Config plugin that lists the app in Android Auto |
| `patches/` | patch-package fix for `@rntp/player` |

## Durable audiobook playback

Playback has one owner: `PlaybackSession`. Screens and the Android background
handler issue commands through `src/player.js`; they do not replace the native
queue or write progress independently.

- Progress checkpoints are serialized every five seconds and on pause, seek,
  transitions, errors, backgrounding, recovery, and sleep.
- A normal cold resume starts five seconds before the saved position, clamped
  to the beginning. Explicit seeks and expired-stream recovery are exact.
- If Android kept a valid media session alive, the app adopts it without
  clearing, seeking, pausing, or restarting playback.
- A fully reconstructed session loads paused. Legacy Continue Listening data is
  migrated on first use when Auto Resume is enabled.
- Signed stream URLs and credentials are not stored in the session record or
  diagnostics.

Automated verification:

```bash
npm test
npm run typecheck
npm run lint
npm run doctor
npm run export:android
```

Lint currently reports the existing warning backlog but must have zero errors.

> File access goes through `expo-file-system/legacy`. Since SDK 54 the root
> `expo-file-system` exports of `getInfoAsync`, `deleteAsync` and friends are
> stubs that throw at runtime; `src/__tests__/fileSystemImports.test.js` fails
> the build if one creeps back in.

## Related projects

- **BusTAudio backend / Stremio addon** — the server this app talks to; it
  generates the install link on its `/configure` page and serves the `/app` API.
  https://github.com/AFK-Goblin/BusTAudioBooks
