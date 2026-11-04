# Changelog

# 2.4.6 — Torrent connection and resume reliability

- Restored WebTorrent's native uTP alongside TCP so peers that do not accept TCP connections can still connect.
- Reuse one torrent client for the app lifetime, keeping DHT state warm across queued downloads and resume.
- Cache fetched magnet metadata with each queue item and reuse it to skip the second metadata exchange when the download starts.
- Keep single and two-file torrents on the direct queue path; apply picker file priorities only when the user selects files.
- Keep torrents waiting for peers active for up to 30 minutes instead of failing at five minutes, while showing the real connected transport and discovery status.
- Keep downloads uncapped by default; the existing speed limit setting controls the shared torrent client when enabled.

# 2.4.5 — Torrent file selection and aria2 transfers

- Routed torrent transfers through the bundled aria2 engine with BitTorrent TCP, DHT, peer exchange, local discovery, UDP tracker support, verified pieces, and per-download resume data.
- Added a pre-download file picker for torrents with more than two files, including filtering, file-type icons, selected-size totals, destination free space, and select-all/none controls.
- Multi-file results keep their folder structure; flat selections are collected into one clean folder. Transfer staging stays unique to each queue item and is removed after successful publishing.
- Added a permanent Add torrent control on the Torrents page with a reduced-motion-aware, opacity-only halo.
- Targeted torrent unit checks and the production renderer build passed. No live swarm speed benchmark was run.

# 2.4.4 — Torrent transport and peer discovery

- Restored WebTorrent for desktop torrent jobs and enabled its native uTP transport, DHT, peer exchange, local discovery and UPnP/NAT-PMP mapping.
- Kept private torrent metadata off supplemental public trackers and retained verified piece storage for pause and resume.
- Torrent status now reports the active TCP/uTP transport and connected peers separately from tracker-reported swarm counts.
- Automated tests and real-world speed benchmarks were not run at the user's request.

# 2.4.3 — Native torrent transfer engine

- Replaced the stalled WebTorrent transfer path with bundled aria2 for BitTorrent TCP, DHT, peer exchange, local peer discovery, and tracker connections.
- Added authenticated loopback JSON-RPC, persisted partial downloads for resume, verified torrent piece completion, and packaged the client licenses and source archive.
- Torrent speed still depends on reachable peers, seed capacity, and network conditions; no speed benchmark was run.

# 2.4.2 — Torrent peer coverage and diagnostics

- Enabled packaged native WebRTC tracker connections alongside the existing BitTorrent TCP/uTP, DHT, and peer-exchange paths.
- Added tracker swarm counts and peer-discovery source details to torrent status.
- Automated tests were not run at the user's request; real-world torrent speed has not been benchmarked.

# 2.4.1 — Faster, safer video segments

- Use fast keyframe-aligned stream-copy cuts instead of forced keyframe re-encoding for selected video segments.
- Show “Finding a nearby keyframe” while segment preparation runs, so the queue does not remain on “Connecting” before progress is available.
- Automated tests were not run at the user's request.

## 2.4.0 — Video segments, torrent discovery, and browser status

- Added an accessible video timeline with draggable handles and manual timestamps; yt-dlp downloads only selected sections and FFmpeg makes accurate boundary cuts. Full-video downloads keep their existing path and naming.
- Added daily cached tracker-list updates with a safe fallback set, tracker supplementation for sparse magnets, gradual connection ramp-up, and rarest-first piece selection.
- Torrent rows now report peers, seeds, responding trackers, and a quiet warning when trackers have not responded. Performance gains have not been benchmarked against comparable swarms.
- Added a reduced-motion-aware browser connection pulse and details popover with bundled browser icons, live bridge events, and unknown-browser fallback.
- Fixed an immediate pause/resume race that could drop a resumed transfer from the queue.

## 2.3.1 — Reliable updates and clearer browser setup

- Update checks now compare semantic versions, verify that the Setup EXE asset exists, and fail quietly when GitHub metadata or assets are unavailable.
- Added a Check for Updates control in Settings, clear up-to-date feedback, and version-specific dismissal for update notices.
- The sidebar download-location control opens the folder picker directly and saves the selected destination used by browser downloads.
- Added a compact, dismissible browser-extension installation guide and a restrained one-time cue for the folder actions.
- Completed application downloads can display the icon embedded in the downloaded installer, with the existing generic icon as fallback.
- Kept tray mode's renderer-release behavior and persistent browser/download services intact.

## 2.2.2 — Cairo, tray idle, and responsive audio control

- Bundled the Cairo variable font and OFL license; Arabic UI now uses Cairo without requiring a system font install.
- Closing to tray releases the UI renderer while preserving browser and download services; browser bridge requests recreate and show the window.
- Hidden status and browser pages stop polling. Completion volume changes persist on release rather than during every drag event.
- Corrected large-transfer verification to inspect the private partial workspace; validated a 3.22 GB pause, backend restart, resume and hash check.

## 2.2.1 — Library polish, bundled browser setup, and reliable torrent drop

- Refined empty library pages with page-specific copy, less inactive table chrome and one clear primary action.
- Rebalanced toolbar spacing, control legibility and status-bar grouping across window sizes.
- Stabilized sidebar navigation during progress updates and added a quiet pulse to the selected section while its transfers are running.
- Moved the estimated time remaining next to each active download's name; estimates appear only when size and speed data are available.
- Fixed Windows `.torrent` drag and drop by resolving the real dropped file path through Electron's safe file utility.
- Included browser extension files in Windows app packages and added an **Install extension** action that prepares them and opens the selected browser's extension manager. GetANNY detects the extension handshake after the browser's required approval; standalone extension ZIPs remain available as a fallback.
- Opened browser extension managers in a new browser window with their browser-specific internal URL.
- Increased the selected navigation item's activity pulse while keeping it restrained and aligned with the active theme.

## 2.2.0 — Capture, playlists and performance

- Added window-wide drag and drop and clipboard paste/monitoring for supported links, magnets and torrent files; clipboard monitoring is opt-in.
- Added playlist extraction and bulk MP4 quality selection in Media Studio, with virtualized entry lists.
- Added per-popup opt-in cookie handoff. Matching URL cookies stay in memory, are stripped from persistent records and logs, and expire with the transfer or app session.
- Added variable-height virtualization for large download libraries, one-second status-bar updates, click-through to Active downloads, and torrent upload speed.
- Added a bundled completion chime with on/off, volume and preview controls.
- Added renderer section error boundaries and audited secondary-text contrast across the 12 themes.
- Preserved existing 12 themes, browser IDs, translations, shortcuts and SQLite schema.

## 2.1.3 — Workspace and tray refinement

- Consolidated download search, type filters, pause, sort and history actions into one compact toolbar. The sidebar now holds the single primary New download action.
- Removed redundant Back controls and marketing subtitles from primary pages; displayed the New download shortcut now matches the host operating system.
- Added the completed-download count to the persistent live status bar and removed duplicated transfer totals from each download view.
- Refined browser connection status, compacted settings controls, and rebuilt theme previews to show an application frame, list and status strip.
- Fixed tray interaction so a visible window hides on tray click, a hidden or minimized window restores on click or explicit Show, and OS activation does not undo close-to-tray.
- Quit now shuts down the desktop services and prevents a browser native-host reconnect from relaunching GetANNY; opening the app manually clears that stop state.
- Kept download, browser, settings and theme actions wired to their existing services and state.

## 2.1.2 — Setup, subtitles and interface polish

- The first-run browser setup is now remembered: a verified extension handshake marks setup complete and later launches open the download library directly. The setup screen only appears again when opened from the sidebar.
- YouTube and other captions now download from the analyzed track URL with retries, then convert VTT ↔ SRT locally, so subtitle downloads no longer depend on a second yt-dlp page scrape or FFmpeg post-processing.
- Fixed the duplicated, misaligned selection checkboxes: each row now owns a real checkbox column, the header select-all matches it, and the selection toolbar keeps its state.
- Rebuilt the Media link field: the clear button sits inside the input as a subtle inline control instead of a detached grey square.
- Moved Back out of the title bar into a sticky context bar, mirrored automatically for right-to-left layouts.
- Arabic layout fixes: mirrored switches, logical margins and borders, translated chevrons, right-aligned tab bars, LTR numbers, paths and progress tracks.
- Nordic is now the default theme for new installations, and the browser extension (popup and floating button) mirrors the desktop palette over the authenticated bridge.
- Performance: the app shell no longer subscribes to every download tick, inactive download tabs skip reconciling their rows, memoized row callbacks avoid needless re-renders and off-screen rows are layout-skipped.
- Fixed the Torrents section, which previously opened an empty workspace.

## 2.1.1 — Workflow, interception and localization release

- Studio and Media link fields show the active link with an inline clear (X) control that also resets analysis state.
- Downloads gained native multi-selection, batch removal, Escape to leave selection, and a scoped Clear history menu for selected, completed, failed or all history. History cleanup never deletes downloaded files.
- Every workspace subsection and download detail sheet now has one contextual Back control that preserves tab and filter state.
- Intercepted browser files are queued and started automatically; the paused browser copy is erased only after desktop ownership is confirmed.
- Torrent output uses the swarm metadata name instead of UUID folders, and legacy folders migrate on resume.
- Chunk and partial files live in a private per-transfer work directory outside the destination.
- Added centralized English, Arabic (RTL), French and Spanish localization with immediate switching and persistence.
- The floating video-page button uses the official GetANNY mark and wordmark.

## 2.1.0 — Obsidian identity release

- Adopted the official supplied eagle/shield mark and GetANNY wordmark unchanged. A reproducible generator rebuilds transparency, recolours and resamples the original artwork into a multi-resolution Windows ICO, ICNS, application/tray/notification PNGs, installer header and sidebar bitmaps, favicon and browser-extension icons.
- Branded the application shell, startup screen, About panel and browser-assistant popup; both the mark and lettering render as theme-aware masks so the original artwork is never redrawn or replaced.
- Rebuilt the palette catalogue around the monochrome identity: **Obsidian** and **Porcelain** are the logo-native dark/light defaults, High Contrast is pure monochrome, and the nine other palettes keep their character with restrained accents. Removed leftover mint-specific glows in favour of theme tokens.
- Added installer artwork for NSIS/MSI and updated the in-app repository link to the official `p4yy/GetANNY` repository.
- Bumped the application and all browser packages to 2.1.0. Distribution remains unsigned; Firefox packages remain unsigned development ZIPs.

## 2.0.0 — Windows release source

- Added a daily local-time start window for queued downloads, including overnight schedules and clean-restart persistence.
- Browser review locks the intercepted file link and verifies the matching desktop transfer before cancelling the browser copy.
- Reconciled Chromium handoffs after service-worker suspension using browser-session storage, and avoided browser download-ID reuse collisions and a disconnect race.
- Added browser cookie-store selection when the download exposes a store ID, foreground attention for automatically accepted handoffs, and an Open source action.
- Added standard, reduced and disabled motion modes; compacted page headings and moved Themes beside Settings.
- Added a portable Windows build target and a staged distribution ZIP with installer, extensions, native-host components and setup guides. Release assembly is gated on Windows tests and ZIP content verification.

Known limitations include incomplete localization and Arabic RTL, unsigned Firefox development packages, no native-host cold launch from the portable executable, and unverified consumer Windows/browser scenarios. See the release's measured evidence before treating a package as tested.

## 2.0.0-rc.2

Introduced ordinary browser handoff, an asynchronous range engine, media metadata and subtitles, additional themes, and installed-app verification tooling. The published binaries and their actual verification limits are documented on the rc.2 release page.

# 2.2.4 — Updates and smoother large libraries

- Added an opt-in in-app download and restart prompt for updates from GitHub Releases on NSIS Setup EXE installs.
- Kept MSI, portable, Microsoft Store, and extension update channels independent.
- Reduced rerenders during active transfers and improved windowed rendering for large download and media lists.
