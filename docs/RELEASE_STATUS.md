# GetANNY 2.3.0 pull-request verification status

- Source version: 2.3.0, based on repository `main` after the latest official v2.2.5 release and the newer unpublished 2.2.6 source changes.
- Linux source suite: **125/125 passed with no skips** for this worktree, using real local HTTP/HTTPS, SQLite, yt-dlp/FFmpeg fixtures, authenticated native framing and direct bridge restart/reconnect coverage. See `TESTING.md` for exact scope.
- Production renderer and all eight generic 2.3.0 extension packages built successfully. Automated coverage verifies that generic artifacts contain no private bridge credential.
- `npm audit --audit-level=high` passed the configured gate and reported 15 moderate development/packaging-tree advisories.
- Windows EXE/MSI packaging, install/reinstall/uninstall, compiled C# launcher, actual extension reconnect across installed-desktop restart and branded-browser matrix: **not yet executed for this change**. A pull request or workflow definition is not a passing result.
- No v2.3.0 tag, GitHub release, installer bundle or final download link has been published.
- Windows packages produced by repository CI are unsigned unless an authorized signing certificate is supplied; signature status must be taken from exact-run evidence.

---

# GetANNY 2.2.6 source status

- This newer source revision added cloud/private-download cookie handling and filename/content-type fixes after v2.2.5.
- The canonical `p4yy/GetANNY` repository has no published `v2.2.6` release. Earlier documentation claiming otherwise was incorrect.
- Any local 2.2.6 builds are not official release evidence and are superseded by the 2.3.0 candidate work.

---

# GetANNY 2.2.5 release status

- v2.2.5 is the latest official canonical release at the time 2.3.0 development began.
- It fixes the 2.2.4 Setup EXE update-check configuration and includes local renderer/Windows package builds.
- Its release notes disclose that automated tests were skipped; it is not evidence that browser integration worked in normal installed profiles.
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
