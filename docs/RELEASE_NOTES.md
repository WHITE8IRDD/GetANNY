# GetANNY 2.3.0 — Reliable direct browser bridge

Browser integration now uses an authenticated loopback WebSocket as its primary transport across Helium, Chrome, Chromium, Brave, Firefox, Vivaldi, Opera and Edge. Native Messaging remains a secure cold-start and first-connection bootstrap rather than a fragile prerequisite.

- Provisions every supported browser during EXE/MSI setup without depending on executable detection.
- Uses distinct 256-bit credentials for native bootstrap, manual recovery and each browser; generic release ZIPs contain no secret.
- Connects prepared extensions directly, persists credentials delivered through authenticated native bootstrap, and reconnects with bounded exponential backoff after desktop/browser worker restarts.
- Separates installer setup from SQLite, download engines, windows and the fixed bridge port; packaged startup repairs stale version/path or missing prepared files.
- Registers and removes native-host keys in both 64-bit and 32-bit Windows registry views and reports partial failures honestly.
- Hardens loopback Host/origin checks, browser/credential binding, payload/header limits and unsafe forwarded-header rejection.
- Adds installer, identity migration/race, registry-view, native-bootstrap, direct-authentication, restart-recovery and secret-free-package coverage.

See `BROWSER_INTEGRATION_V2.md` for the verified source-level root cause, architecture comparison, security model and validation limits. Browser approval remains explicit; permanent Firefox installation still requires Mozilla signing.

---

# GetANNY 2.2.6 — Cloud Downloads & Extension UI Update (unpublished source revision)

Cloud and private downloads now receive the browser session cookies they need by default, fixing Google Drive failures that previously saved an HTML sign-in page or an extensionless file named `identifier`.

- Redesigned the extension cookie control with a clear label and privacy explanation. The preference is stored in `chrome.storage.local` immediately and survives popup closes and completed downloads.
- Background browser downloads automatically request cookies for the target domain, while an explicit opt-out is respected.
- Parses RFC 5987/6266 `filename*=` values, falls back to `Content-Type` for the extension, and never uses `identifier`, `uc` or `download` as a filename.
- Detects Google Drive virus warnings and sign-in pages before a corrupt HTML file is saved, showing: “Authentication required: Please ensure site cookies are forwarded via the browser extension.”
- Disables multi-segment downloads when `Accept-Ranges: bytes` is absent or the response is a dynamic ZIP stream, falling back to one connection.
- Rebuilt Windows Setup EXE, MSI, portable EXE, Store AppX and all eight browser extension packages.

No canonical `v2.2.6` GitHub release was published. These source changes are included in 2.3.0.

---

# GetANNY 2.2.5 — Updater configuration fix

The Windows Setup EXE now includes the GitHub feed configuration required by the in-app updater and points to the current GetANNY repository. The packaged resource check fails the build if this configuration is missing or incorrect. MSI and portable installations remain outside the GitHub updater channel.

This patch release also includes the 2.2.4 responsiveness and large-list improvements.

---

# GetANNY 2.2.4 — Updates and smoother large libraries

The installed Windows Setup EXE can now check GitHub Releases for a newer GetANNY version. GetANNY asks before downloading and asks the user to restart to install. MSI, portable, Microsoft Store, and browser-extension distribution remain on their separate update paths.

- Added an in-app update prompt with download progress and a restart-to-install action.
- Configured the NSIS Setup EXE release feed and include its `latest.yml` and block map in the Windows release assets.
- Limited GitHub updater activation to installs made by the NSIS Setup EXE. Store, MSI, and portable installs do not use this updater.
- Separated high-frequency transfer progress from download metadata so a progress tick updates the affected row instead of recalculating the entire library.
- Improved variable-height list windowing and playlist rendering for large libraries.

---

# GetANNY 2.2.2 — Cairo Arabic typography, lighter tray idle, and smoother controls

This build bundles the Cairo font for Arabic, makes completion-volume dragging smooth, releases the hidden renderer when the app closes to tray, and reduces hidden-page polling. Download, pause/resume, file integrity, browser bridge, and tray wake behavior were covered by local automated tests. The Windows binaries are unsigned in this environment; this file records local build status and does not claim GitHub or installed-consumer certification.

## Performance and tray behavior

- Closing the window with **Close to tray** enabled destroys the renderer process while retaining the download manager and authenticated browser bridge. The app recreates its window when the tray is opened or the bridge receives a browser request.
- Status-bar and browser-integration polling stop while the relevant renderer is hidden.
- Large-file pause/resume verification now inspects the private transfer workspace, proving the visible byte count matches durable segment data.

## Arabic typography and sound controls

- Cairo variable font is bundled in the app and used for Arabic UI text. The SIL Open Font License is included in the renderer package.
- Completion-sound volume now updates during a drag and persists once when the pointer is released. Pointer and keyboard behavior are covered by UI integration tests.

## Verification

- 107 local regression tests passed; 13 packaging and tray checks passed; local browser UI integration passed; a 3.22 GB transfer passed pause, restart, resume and SHA-256 verification.
- The local Windows EXE, MSI and portable packages were built. Installed-consumer testing, GPU utilization measurement, code signing, and GitHub Actions were not performed.

---

# GetANNY 2.2.1 — Interface polish and reliable torrent drop

Version 2.2.1 refines empty library states and transfer status hierarchy, fixes dragging `.torrent` files from Windows Explorer into the app, and bundles browser extensions in the Windows app packages. The Browser integration page can prepare the selected browser and open its extension manager from one **Install extension** action. Once the user completes the browser's required installation step, GetANNY recognizes the extension handshake and verifies the connection automatically. Manual browser extension ZIPs remain in the release bundle as a fallback.

## Interface refinements

- Empty library pages now hide table headings when there are no rows, and hide the search/filter toolbar when that page has no records. Search-result empty states keep their controls.
- Active, completed, paused, failed and torrent pages use direct, page-specific empty-state copy. The main download action has clear primary emphasis; clipboard capture remains a quieter secondary action.
- Search, type filters and bulk actions have clearer spacing and disabled-state legibility. The footer groups readiness on the left and transfer metrics on the right, with secondary metadata reduced in emphasis on narrow windows.
- Sidebar items keep their identity through progress updates, eliminating the selected-tab flicker. A subtle count pulse appears only when the selected section has a running transfer.
- Estimated time remaining appears beside an active download's name when both file size and transfer-speed data are available. Torrent peer count stays with the transfer meter.
- Empty torrent pages no longer show completion/resume guidance before a torrent is added.
- Browser integration prepares the bundled extension and opens the selected browser's extension manager. The browser requires the user to approve/load the unpacked extension; GetANNY then detects its handshake and verifies the connection.

## Torrent drag and drop

- Electron now resolves the actual filesystem path for a dropped `.torrent` file through `webUtils.getPathForFile`, then passes that path to the existing torrent flow. This avoids sending the filename alone, which the torrent engine correctly rejected as neither a magnet link nor a valid file path.
- If the dropped file path cannot be read, GetANNY gives a clear fallback to the existing **Choose file** control.

## 2.2.0 feature set

GetANNY 2.2.0 adds faster ways to capture downloads, playlist extraction, and optional feedback while keeping the existing desktop design, themes, translations and browser handoff flow.

## Download capture

- Drop a supported link, magnet, or `.torrent` file anywhere in the app. Direct links open the New download dialog; supported media pages open Media Studio; torrents open the torrent flow.
- Paste clipboard contents from download-library empty states. Optional clipboard monitoring checks text once a second and shows a five-second capture prompt; it is off by default.
- HTTP `.torrent` links can be added alongside local torrent files and magnet links.

## Media playlists

- Media Studio can list up to 1,000 playlist entries, select or invert selections, and queue selected videos individually.
- Playlist output is virtualized. Quality selection prefers MP4 formats at or below the chosen resolution; items with no matching MP4 are skipped and reported.
- The existing single-media analysis and download flow remains available.

## Session cookie handling

- The browser popup has an opt-in **Include site cookies** control, off by default. The extension asks the browser only for cookies matching the specific target URL.
- Session and authorization headers are held in memory for the transfer and are excluded from SQLite headers/metadata, renderer download events, and application logs. Redirects to another origin strip those headers.
- Sensitive headers are discarded on completion, failure, cancellation, or shutdown. An interrupted transfer cannot silently resume with an expired session; it reports that the download must be refreshed from the browser.
- JavaScript runtimes cannot promise physical zeroing of immutable string copies, so the guarantee is that GetANNY drops its references and never intentionally writes the values to disk or logs.

## Performance, status and sound

- Long download and playlist lists render through a measured variable-height window rather than mounting every row.
- The footer updates once per second and opens Active downloads when clicked. Torrent upload speed is shown when available.
- A bundled soft chime can play after successful completion, with an enable switch, volume slider and preview in Settings. It is enabled by default and throttled to one play per two seconds.
- The secondary text tokens in all 12 themes were checked against the app surfaces; the muted text contrast minimum is 4.8:1 in the tested surface set.
- Major workspace panels have local error boundaries so one renderer failure does not take down the shell.

## Verification and distribution

See `RELEASE_STATUS.md` for what was verified. GitHub Actions Windows/browser tests were skipped at the owner's request. The binaries are unsigned; check SHA-256 values before running them. The release contains EXE, MSI, portable, eight browser extension ZIPs and a complete Windows bundle.
