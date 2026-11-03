# GetANNY 2.4.1 release status

- Source version: 2.4.1, based on the 2.4.0 release with a video-segment performance/output fix.
- The change disables forced keyframe re-encoding so FFmpeg can cut on nearby keyframes and copy encoded streams. Segment rows now show a preparation phase before byte progress begins.
- The Windows Setup EXE, MSI, single-file portable EXE, unsigned Store AppX, and unpacked app folder were built successfully. The bundle includes all four Windows formats, the eight browser extension ZIPs, setup helpers, docs, and SHA-256 checksums.
- Windows App Certification Kit validation was not performed. GitHub publication status will be recorded in the release assets.
- Automated tests were not run at the user's direction.

# GetANNY 2.4.0 release status

- Source version: 2.4.0.
- Windows x64 Setup EXE, MSI, portable EXE, and unsigned Store AppX were built successfully from this source. The renderer and all eight browser extension ZIPs also built successfully.
- Focused segment, tracker-list, and torrent-engine tests passed 9/9. A real yt-dlp/FFmpeg segment-cut test passed and verified the output duration and timestamped filename.
- The complete local suite reported 139/142 passing. Three environment-sensitive checks failed: a Windows child-process timeout assertion, the local OpenSSL test-CA process, and physical `.part` preservation during managed-media pause/restart. The pause/restart behavior remains unverified.
- A previous renderer UI run passed the browser popover, disconnect, and transfer checks but failed an existing completion-volume slider drag assertion. A production-window launch check was not completed; launching the test executable activated the already-installed 2.3.1 app.
- Windows App Certification Kit validation was not run. The AppX identity is `AcevisualsCo.GetANNY` with publisher `CN=C9138F01-73FF-487D-80C4-21BBA2C93B73`; confirm it matches the reserved Partner Center identity before submission. All Windows binaries are unsigned.
- Torrent performance is unmeasured; no comparable before/after benchmark is available.
- GitHub Actions installation/browser workflows were skipped at the requester's direction; local tests are recorded above.
- GitHub publication status is recorded in `Documentation/RELEASE_INFO.md` in the Desktop bundle.

---

# GetANNY 2.3.1 release status

- Windows EXE, MSI, portable EXE and Store AppX packages were built locally from source version 2.3.1.
- All 136 local automated tests passed; the renderer production build and eight browser extension packages also completed.
- The Windows App Certification Kit ran file-only checks: 15 passed, 0 failed. Runtime install/launch checks were not run.
- GitHub Actions installation/browser tests were skipped at the owner's direction. The binaries are unsigned; SmartScreen may warn.
- GitHub publication status is recorded in `Documentation/RELEASE_INFO.md` in the bundle.

---

# GetANNY 2.3.0 release status

- Source version: 2.3.0 at merged `main` commit `0cc4045f011231d8e626eac1a4c5acd4926ac482`, after the latest published v2.2.5 and unpublished 2.2.6 source changes.
- Source/backend, compiled launcher, renderer, packaging and all eight generic extension-package stages passed before the immutable Windows artifact was retained. Generic extension artifacts contain no private bridge credential.
- Measured follow-up evidence completed EXE and MSI install/reinstall/uninstall, retained user history/settings and removed owned integration state. The overall browser matrix remained non-green, so this is not a fully passing automated result.
- At the repository owner's explicit direction, publication proceeds from the existing main-commit artifact without waiting for further lengthy GitHub Actions installation/browser runs. Manual Windows testing is required.
- The retained artifact does not contain `latest.yml` or the NSIS block map; this publication supports manual downloads rather than the in-app auto-update feed.
- Automated checks intentionally not required for publication include the remaining/current browser-matrix rerun. Consumer-PC interactive approval, permanent signed Firefox installation, old-v1 upgrade, store delivery and code-signing validation remain manual/unavailable.
- `npm audit --audit-level=high` passed the configured gate and reported 15 moderate development/packaging-tree advisories.
- Windows packages are unsigned because no authorized signing certificate was supplied. Windows may display SmartScreen or publisher warnings.
- The release's `MEASURED_RESULTS.md`, `PROVENANCE.json`, `WINDOWS_VERIFICATION_STATUS.json`, checksums and raw evidence record the actual result; publication must not be interpreted as certification.

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
