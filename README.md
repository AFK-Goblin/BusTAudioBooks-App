# BusTAudio — Android app

An Expo/React Native audiobook app for the [BusTAudio backend](#related-projects): search,
**stream**, **offline download**, background playback with lock-screen controls,
chapters, bookmarks, a sleep timer, and **Continue Listening** with saved progress.

It talks to your server's `/app` API. Users configure it once by pasting their
BusTAudio install link (the same link they'd use in Stremio).

## Features

- **Home / Library / Settings** tab navigation, with a mini-player (cover art +
  live progress) docked above the tabs.
- **Streaming and offline downloads** — downloads run in a native background
  downloader, survive screen-lock *and* the app being killed (they're re-attached
  on next launch), and failed downloads stay visible with Retry/Dismiss.
- **Player**: chapter list + quick chapter picker, bookmarks (tap "+ Bookmark" or
  long-press play), speed control that persists as your default, sleep timer
  (minutes or end-of-chapter) that keeps working in the background, and
  configurable skip intervals that also apply to the lock-screen controls.
- **Self-healing streams** — expired TorBox links are silently re-resolved and
  playback resumes where it was.
- **Settings**: default speed, skip intervals, Wi-Fi-only downloads, auto-resume
  on launch, auto-delete finished downloads, storage usage + wipe, server
  connection, update checks.
- **Updates**: JS-only changes ship over-the-air via `eas update` (checked at
  launch and on foreground, ~hourly); native changes ship as a new APK announced
  through the backend's `/app/version` endpoint.

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

> First build tip: if the build fails, it's almost always a version/native config
> nudge. Paste the build log and it's usually a one-line fix. A common one: if the
> log complains about the new architecture, it's already disabled here via
> `"newArchEnabled": false` in `app.json`; if it complains it's *required*, remove
> that line.

## Ship an update

**JS-only changes** (screens, logic, styling — no new native modules, no
`app.json` native config changes, no `version` bump):

```bash
eas update --channel preview -m "what changed"
```

Installed apps fetch it on next launch/foreground and show a "Reload" banner.

**Native changes** (new native dependency, `app.json` native config, version
bump): build a new APK with `eas build`, host it, and point the backend's
`/app/version` response at it — installed apps will show a download banner.

> ⚠️ `runtimeVersion` follows `version` in `app.json`: bumping the version cuts
> older installs off from OTA updates, so only bump it together with a new APK.

## Using the app

1. On first launch it asks for your **install link** — the `https://…/…/manifest.json`
   link from your server's `/configure` page. Paste it, tap Connect.
2. **Search** → tap a book → **Stream now** or **Download for offline**.
3. **Library** holds Continue Listening, Downloads, and Finished books.

## How it maps to the backend

- Search → `GET /<config>/app/search?q=…&page=…`
- Play/Download → `GET /<config>/app/streams/<id>` → TorBox HTTPS file link(s)
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
| `src/player.js` | track-player setup, queue loading, sleep timer, stream recovery |
| `src/downloads.js` | Background downloads, resume-after-kill, storage management |
| `src/downloadStore.js` | Observable in-progress download state |
| `src/library.js` | Local library: progress, downloads, finished, bookmarks |
| `src/settings.js` | Persisted user settings store |
| `src/theme.js` / `src/ui.js` / `src/icons.js` | Theme, shared UI, view-drawn icons |
| `src/layout.js` | Status-bar/tab-bar metrics |
| `screens/*` | Setup, Search, Book, Player, Library, Settings |

## Related projects

- **BusTAudio backend / Stremio addon** — the server this app talks to; it
  generates the install link on its `/configure` page and serves the `/app` API.
  https://github.com/AFK-Goblin/BusTAudioBooks
