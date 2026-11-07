# BusTAudio for Windows

A portable Windows x64 app for the same BusTAudio audiobook catalogue, with invite-only personal accounts. Each account keeps its own saved books, listening progress, bookmarks and finished books. The first release streams audio; it does not download books for offline playback.

## Run the Windows app

1. Extract **all** files from `build/BusTAudio-1.0.0-windows-x64.zip` into a folder you control.
2. Open `BusTAudio-win32-x64/BusTAudio.exe`. Keep the adjacent files and folders with it.
3. Paste your existing secure BusTAudio install link. Use the same server as your Android app.
4. Choose **Create account**, enter the invitation issued by the server owner, and enter its assigned username and choose your own password. Existing users choose **Sign in**.
5. Search the catalogue, open a book and save it or start listening. The player supports parts, playback speed, seeking, skip controls and bookmarks.

This build is unsigned. Windows may show an unknown publisher prompt. A Windows signing certificate was not supplied. It is built on Linux and still needs a native Windows playback and credential-storage check before wider distribution.

Personal accounts require the companion accounts server routes to be deployed with persistent database storage. An older catalogue-only server cannot sign users in. The owner creates a separate invitation for each person with the accounts backend's local administration command; registration is not public. Keep the install link and invitations private.

## Existing libraries and other devices

To bring a phone library into your account, export a BusTAudio JSON backup from the phone. In Windows **Settings**, choose the backup, review the book count, and confirm the import into the displayed account. Import copies only book information, saved state, progress and bookmarks. Downloaded audio, device paths, install credentials and signed stream links are excluded. If a book already exists in the account, review which copy to keep; an import never silently replaces it.

On Android, open the personal-library account screen, sign in to the same account, and explicitly choose to connect/import the phone library before syncing. Android account sync is manual in this release. Use **Sync now** after listening on your phone, then **Refresh library** on Windows before continuing. After listening on Windows, use **Sync now** on your phone before resuming. Downloads stay on the device that downloaded them.

Windows progress saves while listening and when pausing. Refresh the library to bring in changes from another device. If another device changed a book or a save could not reach the server, the app shows a recovery choice. Compare your unsaved changes with the account copy and deliberately keep one. Cached changes are never automatically replayed over a newer account copy. Signing out clears the displayed library, pending writes and protected local account cache.

## Development

Use Node 22 or later and npm:

```sh
cd desktop
npm ci
npm test
npm start
```

The app pins Electron 45.2.3, `@electron/packager` 20.3.0 and Playwright 1.65.0. Development-only `glob` and `minimatch` overrides avoid the advisories in the packager's transitive dependency ranges. No npm packages are needed by the packaged application at runtime.

Renderer smoke testing:

```sh
npx playwright install chromium
npm run test:ui
```

On a host with an existing compatible Chromium build, set `CHROMIUM_PATH` to the browser executable. Linux needs the shared libraries listed by Playwright. The smoke harness injects its fixture bridge into the test browser only; no test switch or fake account is included in the app.

Build the portable Windows x64 bundle on Windows, macOS or Linux:

```sh
npm run build:win
```

The build uses Electron Packager's JavaScript Windows resource editor and a streaming ZIP writer, so it does not require Wine, Python or a system ZIP command. Output: `build/BusTAudio-1.0.0-windows-x64.zip`. The build directory and dependencies are ignored by Git. Rebuild after source changes.

## Security and verification

- Sandboxed renderer, context isolation, no Node integration, restricted Content Security Policy, blocked navigation/new windows, denied permission requests.
- Narrow preload methods validate their sender against the trusted main frame. The renderer cannot supply a request route, arbitrary filesystem path or shell command.
- Session tokens and the install prefix remain in Electron's main process. Credentials and the local library cache use Electron `safeStorage`; Windows protects them for the current Windows user. No plaintext storage fallback is accepted.
- HTTPS install links only; API redirects are rejected. Image and audio URLs must use HTTPS. Signed audio URLs are used only for playback and are not put in the personal library.
- Account writes use per-book revisions. Conflicts and failed saves are held for explicit recovery. Late responses after sign-out cannot attach data to a new account.

`npm test` exercises link and sender validation, backup sanitization, revision conflicts, stale player drafts, failed-save recovery and logout races. `npm run test:ui` covers sign-in, searching, details, saving, preparation status, backup confirmation and sign-out privacy. A second real WAV playback smoke checks resume, speed, seeking, bookmarks, part changes, progress saves and conflict pause. A browser smoke test is not a native Electron/Windows test: verify actual Windows sign-in, logout/relaunch, playback, seeking, part changes and two-device conflict recovery against a deployed accounts server before release.

For an HTTP contract check against a temporary real SQLite backend:

```sh
BUSTAUDIO_SERVER_ROOT=/absolute/path/to/torbox-audiobooks-accounts npm run test:contract
```

This test creates and removes its own database and accounts; it does not use the live server.
