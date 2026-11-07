# Windows and personal libraries implementation plan

User requested a Windows app using the existing catalogue and chose private individual sign-ins for approximately four people. Existing mobile library remains intact; accounts do not automatically claim another installation's books.

## Architecture and contract

- Windows Electron application in `desktop/` of the mobile repository, shipped as a portable Windows x64 bundle. Existing catalogue prefix/install link remains supported. Sandboxed local UI, narrowly scoped IPC, no Node in renderer; credentials only in main process and OS-encrypted storage.
- Account backend in `/workspace/BusTAudioBooks/torbox-audiobooks-accounts`, branch `codex/personal-accounts`. SQLite on a durable path, Node >=22.13 (built-in node:sqlite), invite-only accounts, scrypt password hashing, hashed random session tokens, expiry, logout revocation and login throttling. Existing catalogue clients unaffected.
- All personal API routes below `/:config/app/accounts` and validated through the existing catalogue access gate. No request may choose another user ID. Session identity owns all library rows.
- POST `/register` {username,password,invite} and `/login` {username,password}: {token,user:{id,username},expiresAt}.
- GET `/me`: {user:{id,username}}. POST `/logout`: success (revokes current token). Authorization uses `Bearer <token>`.
- GET `/library`: {books:[record]}. PUT `/library/:id`: {baseRevision,book} or {baseRevision,deleted:true}. Response {record}. A stale baseRevision returns HTTP409 {error:"conflict",record}; baseRevision is 0 for a new entry. Tombstones retain revision and prevent resurrection.
- record: {id,revision,deleted,book}; book omitted/null when deleted. Server whitelist: id,title,author,poster,format,saved,savedAt,rating,progress:{position,duration,trackIndex,lastPlayed,finished,trackDurations,rate},bookmarks:[{createdAt,position,trackIndex,note}]. No downloaded flags, local file paths, signed streams or install credentials synced.
- Windows library/search/details/streaming player, chapter/part names, speed/seek/bookmarks, progress persistence, explicit conflict handling and backup import. Accounts isolate local cache and server requests; logout clears displayed private data.
- Android account bridge provides sign-in and deliberate import/sync with identity binding and conflict handling; do not automatically attach pre-existing device data to an arbitrary account or overwrite local downloads.

## Tasks

- [x] Backend: write failing HTTP isolation/auth/CAS tests, implement SQLite account service and local admin invite/reset tool, add integration routes and deployment instructions, run entire backend suite.
- [x] Desktop: create secure Electron main/preload, a responsive dark audiobook UI, account sign-in/registration, catalogue browsing and player, library persistence/sync and backup import. Test API validation and privacy, produce portable Windows x64 artifact and exercise renderer in browser where possible.
- [x] Mobile bridge: add account screen and sync service, explicit opt-in import of phone library, detect conflicting changes; preserve offline files and prevent uploads after account/server changes. Test migration, rejected sessions and conflict behavior.
- [ ] Integrate: verify matching contracts, independent security/correctness review, full suites and typecheck, document deployment and artifact. Do not claim a Windows-native test from a Linux host.

## Delivery constraints

Server deployment requires identifying existing hosting and a durable volume. Do not publish a mobile update that assumes unavailable account endpoints. No public registration, no user-ID selectors, no plaintext credential logging or checked-in secrets. Signing a Windows executable requires a signing identity; an unsigned portable build is acceptable with an explicit delivery note. Device downloads remain on each device.

## Verification and delivery status

Mobile:48 suites/336 tests, typecheck and lint pass (four existing hook warnings). Backend:70 tests pass before installer tests. Desktop core and real-audio renderer scenarios pass, including late stream selection and stale resume revision regressions verified by mutation. Real SQLite HTTP contract phone→desktop→phone passes. Native Windows execution remains pending; server deployment remains pending because hosting terminal access is not available in this workspace. The public health endpoint still reports3.2.0 without accounts. Android account changes are not published yet.
