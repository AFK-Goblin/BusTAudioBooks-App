# BusTAudio for Windows

A Windows x64 app for the same BusTAudio audiobook catalogue, with invite-only personal accounts. Each account keeps its own saved books, listening progress, bookmarks and finished books. Windows streams audio; it does not download books for offline playback.

## Run the Windows app

1. Close the old portable app and run **build/BusTAudio-Setup-1.1.0-x64.exe** once.
2. Open **BusTAudio** from the Start menu. Use this installed copy going forward.
3. Existing app data is retained under the same Windows user: package name and product name are unchanged. New installs ask for your secure BusTAudio install link and personal account.
4. Choose your accent in **Settings → Appearance**. The library highlights your most recently listened book; long player titles expand on hover or keyboard focus.
5. Once the Windows release feed is published, updates check at startup and every six hours, download in the background, and offer **Restart to update**. Settings also provides a manual check and retry. Restart saves your place first and stops if library changes need review. Updates never install automatically on quit.

The optional portable ZIP, **build/BusTAudio-1.1.0-windows-x64.zip**, still works after extracting all files, but does not update itself. Appearance is stored per computer and survives account sign-out.

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

The app pins Electron 45.2.3, `@electron/packager` 20.3.0 and Playwright 1.65.0. Development-only `glob` and `minimatch` overrides avoid the advisories in the packager's transitive dependency ranges. The packaged app includes electron-updater and its production dependencies.

Renderer smoke testing:

```sh
npx playwright install chromium
npm run test:ui
```

On a host with an existing compatible Chromium build, set `CHROMIUM_PATH` to the browser executable. Linux needs the shared libraries listed by Playwright. The smoke harness injects its fixture bridge into the test browser only; no test switch or fake account is included in the app.

Build the Windows installer on Windows (the release workflow uses Windows):

```sh
npm run build:win
```

Output: `build/BusTAudio-Setup-1.1.0-x64.exe`, its blockmap, and `build/latest.yml`. Electron Builder creates an NSIS installer. A native Windows build is the reproducible release path; this ARM Linux workspace cross-builds NSIS under QEMU and uses electron-builder's own UninstallerReader to extract the uninstaller without Wine. The local adapter lives in `/tmp/bustaudio-nsis/build.cjs` and is not needed by Windows CI.

Use `npm run build:portable` for a portable ZIP on Windows, macOS or Linux. This uses Electron Packager and a streaming ZIP writer. The build directory and dependencies are ignored by Git. Rebuild after source changes.

## Publishing automatic updates

The app's update feed is the public GitHub release **desktop-stable**, separate from Android APK releases. Only app binaries and public release metadata go there; no library credentials or account data are included.

1. Push the reviewed source and workflow to the repository. Increment `desktop/package.json` and its lockfile for every new Windows release; update `RELEASE-NOTES.md`.
2. Run the **Windows release** GitHub Actions workflow on that commit. It runs unit/browser checks, builds on Windows, and creates a **draft** tagged `desktop-vVERSION` with installer, blockmap and metadata.
3. Test installation on Windows, retained login/library, playback, and an actual older-to-newer update. Review the draft and publish it.
4. The publish event verifies manifest version, asset name, installer SHA-512/size and rollback protection, then uploads the installer/blockmap to **desktop-stable** before replacing `latest.yml`. Retain previous installer assets for differential downloads. This promotion must finish before installed apps can see the update.

No live Windows release has been published from this workspace yet; GitHub write access is required. A local installer build alone does not make the update feed live. Distribution remains unsigned; HTTPS and release checksums protect transfer integrity, but they do not replace a publisher signing identity.

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
