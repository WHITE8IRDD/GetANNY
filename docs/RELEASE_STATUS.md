# GetANNY 2.2.6 release status

- Fixes Google Drive and other cloud/private downloads that failed with extensionless `identifier`/`uc` files or saved authentication pages.
- The browser extension now includes site cookies for cloud/private downloads by default, persists the checkbox choice in `chrome.storage.local`, and forwards cookies automatically for background download handoffs.
- The popup explains the privacy boundary: session cookies go only to the local GetANNY app, are held in memory for the transfer, and are excluded from history, renderer events and logs.
- Adds RFC 5987/6266 `filename*` parsing, MIME-based filename fallback, HTML sign-in/virus-page detection, and single-connection fallback when `Accept-Ranges: bytes` is missing or a dynamic ZIP stream is detected.
- Windows x64 Setup EXE, MSI, portable EXE, Store AppX and all eight browser-extension ZIPs were built locally for 2.2.6.
- Published as an official GitHub release with a SHA-256 `checksums.txt`.
- Windows binaries are unsigned. Verify the published SHA-256 checksums before running installers.

---

# GetANNY 2.2.5 release status

- Fixes the 2.2.4 Setup EXE update-check error by packaging `resources/app-update.yml` for the GitHub update feed.
- Local renderer production build and Windows x64 Setup EXE, MSI and portable package builds completed. The Setup EXE includes `resources/app-update.yml` for the GitHub updater feed.
- Update-check errors now appear as a compact, dismissible notice in the lower-right corner; retry remains available. No application tests were run, so this build is not test-certified.
- This is a local build only. It has not been published as an official GitHub release.
- Windows binaries are unsigned. Verify the published SHA-256 checksums before running installers.

---

# GetANNY 2.2.1 release status

- Source commit: recorded in `Documentation/RELEASE_INFO.md` in the Windows bundle and linked Git tag.
- Local automated tests: not run for this UI and torrent-drop patch.
- Renderer production build and all eight browser extension package builds: completed locally.
- Windows EXE, MSI and portable packages: built locally with electron-builder.
- The Windows app package contains both browser-extension builds; standalone browser ZIPs remain included as a fallback. Browser extension installation and handshake were not manually retested in the packaged application.
- GitHub Actions Windows/browser verification is intentionally skipped at the owner's request. This release is not represented as passing those remote gates or as manually certified.
- Windows binaries are unsigned. Verify the supplied SHA-256 checksums and review `Documentation/START_HERE.md` before installation.
- Torrent drag and drop and close-to-tray behavior were not manually retested in the installed package.
