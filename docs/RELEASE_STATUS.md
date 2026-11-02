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
