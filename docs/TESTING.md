# Browser integration v2 verification status

This section records outcomes for the current branch. It must be updated from actual commands/workflow evidence before publication; a test definition or prepared package is not a pass.

As of 2 November 2026 in the Linux development workspace for version 2.3.0:

- the complete source suite passed **125/125, with 0 failures and 0 skips**, including real local HTTP/HTTPS, SQLite, yt-dlp/FFmpeg media fixtures, authenticated native framing and direct bridge restart/reconnect coverage;
- all eight generic browser extension ZIPs built successfully and an automated check verified that none embeds a real credential;
- the production renderer built successfully; JavaScript syntax and formatting checks passed for the direct-first state machine and changed integration modules;
- `npm audit --audit-level=high` passed its configured gate while reporting 15 moderate advisories in the development/packaging dependency tree; no claim of zero advisories is made;
- no post-redesign Windows installer, compiled C# launcher, GUI browser, upgrade/reinstall/uninstall or actual extension-worker restart run has completed yet. The Windows harness now requires a browser to reconnect and complete another handoff while remaining open across an installed-desktop restart.

The current application has 12 themes. The `--muted` token contrasts against `--bg`, `--panel` and `--raised` at a measured minimum of 4.81:1 across the theme catalog; `--secondary` is above 5.49:1. These token checks are not a full WCAG audit of every rendered text element.

See [BROWSER_INTEGRATION_V2.md](BROWSER_INTEGRATION_V2.md) for root cause, architecture and security analysis. Release-specific evidence belongs in `RELEASE_STATUS.md` and `MEASURED_RESULTS.md`.

# Historical test evidence and release gates

This file distinguishes executed tests from intended CI gates and manual work. No simulated transfer results are used as download evidence.

## Historical 2.0.0-rc.2 evidence

- Upgrade baseline: `98c4ae7891d20a05dd46e72fcc37c89d72eeb273`. Initial validated upgrade source: `c160fe87df658c4f74cddcf010cc78c82430d80b`.
- Latest full Linux source suite at that source: **79/79 passed, 0 failed, 0 skipped, 50.23 seconds**. This includes real yt-dlp extraction, direct media, adaptive DASH merging, managed media restart/resume, independent VTT→SRT conversion and real FFmpeg preview extraction. The local development tools came from PyPI/npm registries because GitHub release storage is blocked here; Windows packaging still requires the separately pinned SHA-256-verified tools.
- Production renderer and all eight extension packages built successfully. `npm audit --audit-level=high` reported **0 vulnerabilities** on 30 October 2026.
- Full real-backend Chromium UI run passed **13 checks with 22 screenshots** at `2026-10-30T12:56:30.759Z`, with no uncaught renderer errors. It covers HTTP hash/pause/resume, real metadata tabs, thumbnail download, independent SRT plus alongside-video VTT, completed-video preview, all 12 palettes and both system modes at 4.5:1 token contrast, gallery/quick switching, responsive widths and keyboard dialogs. This is not full WCAG or installed-Electron certification.
- New ordinary-handoff unit coverage includes PDF, archive, image, video, document and unknown/large files; cookie/referer/user-agent forwarding; definitive and ambiguous failures; native cleanup retry; private fallback and idempotent review commands. Real installed-browser assertions were added to the Windows Chromium and Firefox harnesses; their outcomes must be read from Windows evidence, not inferred from unit tests.
- Repeatable backend comparison: `node scripts/benchmark-backend.js --compare=98c4ae7891d20a05dd46e72fcc37c89d72eeb273 --runs=3`. Each fresh-process run transferred a generated 128 MiB payload through four ranges and verified SHA-256. Median baseline → current: throughput **152.9 → 220.4 MiB/s** (1.44×), transfer CPU **1452.1 → 805.7 ms** (44.5% lower), peak RSS **210.8 → 103.9 MiB** (50.7% lower), post-GC idle RSS **150.0 → 97.3 MiB**, requests **6 → 5**, persistence saves **10 → 7**, ten full browser-status calls **46.8 → 12.1 ms**. The raw report is `.arena/backend-benchmark.json`.
- Benchmark scope is deliberately narrow: local source backend with the HTTP server in the same process, not public-network speed or whole installed Electron RAM. Short idle CPU sampled **0.052% → 0.085%**; this near-zero difference did **not** demonstrate an idle-CPU reduction and is not presented as one. Installed desktop resource measurement remains a separate gate.
- Initial Windows upgrade run [41059193083](https://github.com/77worldd/GetANNY/actions/runs/41059193083), source `c160fe8`: **79 backend tests and 9 compiled-launcher checks passed; EXE/MSI packaging and test-artifact retention passed.** The overall job then **failed** when the actual NSIS installer hit its 7-minute timeout before installed-app or browser gates. No installation/browser pass is inferred. Diagnostic runs [41061281841](https://github.com/77worldd/GetANNY/actions/runs/41061281841), [41062840553](https://github.com/77worldd/GetANNY/actions/runs/41062840553) and [41064311679](https://github.com/77worldd/GetANNY/actions/runs/41064311679) isolated the cause: `src/shared/themes.json` was omitted from `app.asar`, preventing the packaged services module from loading. The candidate now packages `src/shared/**/*`, checks the catalog in `beforePack`, covers the rule in packaging tests, and catches service-module startup errors with an optional helper stage report. A fresh full Windows run remains required before publication.

## Historical evidence before the rc.2 upgrade

Development began 29 October 2026; historical UTC timestamps are recorded below. The earlier baseline was `f74fea83`.

### Executed in the Linux Arena workspace (historical)

- Latest executed full Linux suite: **62/62 passed, 0 skipped, 50.97 seconds**. Includes explicit Quit/cold-launch/EOF behavior, registration-only history preservation and the real SQLite N-API / torrent / worker packaging contract and read-only MSI resource updates. Process-launch intent tests use a documented spy; actual download evidence uses real processes and transfers.
- **Latest measured Windows run [40980506581](https://github.com/77worldd/GetANNY/actions/runs/40980506581), source `a863dc2`: 61 backend / 9 compiled C# checks passed, 0 skipped.** Actual EXE default-profile checks passed **14/14**, followed by **4/4 actual desktop-lifecycle checks**: compiled-native cold launch and SHA-verified physical download; actual window close without native-host resurrection; actual Desktop and Start Menu shell-shortcut launches/closures. EXE reinstall, uninstall/retention and MSI first/reinstall gates were reached successfully. **The overall job failed at the browser matrix:** Vivaldi exited 0xC0000005 before CDP, Firefox rejected the harness's incorrect automation-access flag, and Chrome's folder-picker helper did not locate the dialog. Chromium, Helium, Brave and Opera passed the complete native/file/media chain. MSI default-profile/cold/shortcut/uninstall tests were **not reached** in that source. The old aggregated installed annotation was truncated near 4 KiB, so exact later retention counts cannot be recovered from it.
- Pending source repairs require a new Windows run: Firefox's exact `-remote-allow-system-access` flag; normal-UI Chrome descendant-window/process-tree diagnostics; minimal headed Vivaldi launch with a **GetANNY-free baseline first**; independent MSI lifecycle/uninstall even after a browser failure, without masking the failed gate; compact, byte-bounded evidence annotations. A failure to establish Vivaldi's clean browser baseline is explicitly **unverified**, never an integration pass. A failure after that baseline passes still blocks publication.
- Historical Windows run [40976436847](https://github.com/77worldd/GetANNY/actions/runs/40976436847), `2914b21`, passed all 14 isolated installed-app checks on both first/reinstall of EXE and MSI (56 checks total), including native framing, HTTPS, actual media merging, local TCP torrent verification, layouts and restart markers. This older measurement does not substitute for the new MSI default-profile lifecycle gates.
- **Production renderer build and all 8 extension ZIP builds passed** after the latest UI/bridge changes.
- Node 22.22.3; actual better-sqlite3 13 platform N-API prebuild loaded and persistence verified.
- Actual local HTTP and HTTPS servers; TLS certificate generated at test time (not a checked-in private key). Certificate rejection and explicit test-CA trust tested separately. Runtime TLS validation is never disabled globally.
- Standard suite: 128 MiB HTTP range download, streamed through workers, exact final byte count and SHA-256 verified. Additional real local-source check transferred **3,221,237,817 bytes (>3 GiB)** through four uneven ranges, physically paused, closed/reopened SQLite/backend, proved continuation within the original first segment and verified final stat/SHA-256. SHA-256: `ac69a951dba58757f437b00997531d477dc9e9a0ad3c143577b85c018b34c0cf`. Reproduce with `npm run test:large-http` (~7 GiB free disk required). This is Linux source-engine evidence, not Windows installed-app or multi-terabyte certification.
- One-connection and segmented pause/resume; writers/workers settled before restart; changed-ETag continuation safely restarted; cancellation cleanup; real 404 / truncated-body / bad-range failures; unsupported HEAD and ignored Range fallback; chunked unknown length; empty files; retry / queue limits / concurrent naming.
- SQLite v1 migration, metadata round-trip, failure/history filtering, clear/delete actions, persisted validated preferences and interrupted-state recovery.
- Real yt-dlp **2026.10.26** obtained from PyPI in this restricted environment; generated local HTML5 video and audio pages plus an adaptive DASH manifest. Actual downloads verified with ffprobe; separate video/audio were merged by actual FFmpeg. This does **not** certify YouTube or other live third-party sites.
- A managed yt-dlp lifecycle test stops the actual child only after physically nonzero partial bytes exist, closes/reopens services and SQLite, asserts nonzero HTTP Range continuation and SHA-256 equality, then verifies real cancellation cleanup and hash-verified retry. This is a real backend restart, not a claim of a full parent Electron cold restart. Full job IDs isolate media/torrent paths and prevent prefix-collision cleanup of unrelated files.
- Local fixture tests used registry-distributed development FFmpeg/ffprobe because the sandbox blocks GitHub's release-assets host. Windows production builds instead require the pinned SHA-256-verified tools in `scripts/tools-manifest.json`; there is no silent production fallback.
- Actual native-protocol subprocess → authenticated local WebSocket → SQLite manager → hash-verified file. This local process is Node on Linux, **not** the Windows C# launcher and **not** an installed branded browser.
- All seven target extension preparations / correct manifests / permissions; prepared does not assert installed. Auth failures and untrusted origins are rejected.
- Live-backend UI test script uses real Chromium and the actual preview services, not mocked IPC. It checks onboarding, add/pause/resume/failure, real media analysis/download, settings, keyboard dialogs and window widths 1320/1024/760/480. See `.arena/ui-test/report.json` for the latest executed result. **Latest executed run: 11 checks passed; 17 screenshots, no uncaught renderer errors (2026-10-30T01:32:07.630Z).** Shift+Tab/Tab focus trapping and focus return are asserted, not inferred from screenshots. Actual Graphite/Midnight/system-light CSS text tokens are checked for at least 4.5:1 contrast across normal, raised and selected surfaces; this is not a claim of complete WCAG certification.
- Root `npm audit` after dependency updates / removal reports zero known vulnerabilities. This is not a guarantee of absence of vulnerabilities.

## Latest follow-up and binary availability

Windows run [40984273113](https://github.com/77worldd/GetANNY/actions/runs/40984273113), source `2515a00`, built both real installers, passed 61 backend / 9 compiled-launcher tests, all three EXE 14-check runs and the 4-check desktop lifecycle. It then failed during EXE uninstall verification, before MSI/browser execution. Complete terminating PowerShell error text was not retained; diagnostic capture and uninstall-helper reports are being added. Do not infer MSI or browser success. Windows cleanup retries and use of a waited GUI helper still require a new run.

The workflow now retains **`GetANNY-unsigned-test-build` immediately after packaging**, with source/run identity, checksums and a prominent unverified-build warning, independently of later installed/browser tests. That artifact is not a verified release. The strict release gate remains separate.

A new regression also exposed settled pause snapshots lagging physical single/segmented partial bytes. Both modes now publish a filesystem-reconciled byte snapshot with zero speed / unknown ETA after writers settle. The 62-test local suite includes this regression; the revised Windows outcome is pending.

## Windows CI gates (must actually pass before publishing)

The workflow runs on **windows-latest**, not on this Linux sandbox. A green job requires:

1. Locked dependency install; real compiled C# smoke and Node unit/integration tests with actual pinned media tools.
2. Stable Chromium installation for real extension testing; packaged SQLite N-API payload verified.
3. Real **GetANNY Setup.exe** and **GetANNY Setup.msi** generated, with mandatory resources and binary hash verification.
4. EXE install; launch its **installed** executable; exercise isolated preload/IPC/renderer, HTTP/HTTPS, pause/resume/cancel/failure, yt-dlp video/audio/merge, local TCP WebTorrent, C# executable/native/WS chain, persistent history/settings and actual layout capture.
5. EXE same-version reinstall and process restart, preserving SQLite markers/history; actual default `%APPDATA%\getanny` profile self-test; read-only record-digest/count/physical-file snapshot before and after actual uninstall. Verify actual desktop/Start Menu shell launches (not just shortcut existence), compiled-native cold desktop launch → hash-verified download, graceful real window close without native-host resurrection, shortcut targets/removal, plus removal of owned native registry entries (report the actual number; zero is not proof).
6. MSI install; equivalent installed-app checks; MSI reinstall / restart preservation and equivalent real default-profile / output / shortcut / owned-registration retention and cleanup checks.
7. Actual unpacked **Playwright Chromium** extension, stable extension ID, authenticated provisioned direct-WebSocket handshake, popup-origin file hash verification, content-script detection, media request and download via the installed Electron UI. Separately verify compiled native bootstrap can cold-start the app and deliver the browser-scoped direct credential.
8. Additional actual-browser direct-transport tests when the verified binaries can be obtained: Helium, Chrome, Brave, Vivaldi, Opera, Edge and Firefox. Firefox uses the supported **temporary** add-on WebDriver API; no signing preference or policy is disabled. Versions / SHA-256s and official download sources are in `scripts/windows/browser-test-manifest.json` (Vivaldi/Opera hashes were cross-checked against Microsoft's winget manifests). The Chrome harness uses the normal visible developer-mode toggle, “Load unpacked” button and actual Windows folder picker in an isolated throwaway profile, not removed load flags or policy/profile edits. Firefox automation explicitly grants WebDriver system access only for its temporary test profile to inspect the real assigned extension UUID; add-on signing requirements stay enabled. Production consent/store installation remains manual. Download unavailability is recorded as unverified. Vivaldi also establishes a separate normal-browser baseline **without GetANNY**; a failed baseline is unverified with its exact error, not app certification. All post-baseline integration failures in available browsers still block publication.
9. MSI uninstall; retained user history; actual Authenticode signature statuses recorded.
10. Reports / installer logs / actual screenshots retained even on failure. A release request only executes after prior steps succeed.

A workflow definition is **not** a passing result. Inspect the workflow run, `windows-test-evidence` artifact / Release `Windows-test-evidence.zip` and its JSON. Reports contain each check's pass/fail, timestamps and errors. The delivery report identifies the actual run and outcome, not a forecast.

## Browser certification matrix

Latest measured smoke results below refer to **40980506581**, not a forecast for newer source. Reports for a later release supersede this development snapshot.

| Browser           | Preparation       | Actual browser → native → download smoke result                                           |
| ----------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| Helium            | Automated         | **Passed** in the measured Windows run                                                    |
| Google Chrome     | Automated         | **Failed**: normal folder-picker discovery; expanded diagnostics require new execution    |
| Chromium          | Automated         | **Passed** with actual Playwright Chromium; not Google Chrome                             |
| Brave             | Automated         | **Passed** in the measured Windows run                                                    |
| Firefox           | Separate manifest | **Failed**: incorrect automation flag; exact required flag awaits new execution           |
| Vivaldi           | Automated         | **Failed**: headed startup crashed (0xC0000005); clean baseline/minimal launch unverified |
| Opera             | Automated         | **Passed** in the measured Windows run                                                    |
| Edge (additional) | Automated         | Unverified individually                                                                   |

All passing entries are fresh-profile developer/temporary extension tests, **not** signed-store installation, upgrade, browser-restart or full lifecycle certification.

## Still requires manual testing / action

- A **pristine consumer Windows 10/11 VM**, with neither Node/Python nor developer tools preinstalled, installing and running EXE and MSI separately. GitHub runners have developer dependencies and do not prove this condition.
- Interactive EXE/MSI wizard branding, directory/desktop shortcut choices, UAC behavior and cancel/back flows. Default shortcut shell launches and compiled-native cold launch passed for EXE in the measured snapshot; MSI equivalents still require a measured run.
- Real cross-version upgrade from the prior released v1 installer with real existing downloads/history, including interrupted legacy partials; same-version CI reinstall is not that test.
- Locked-browser host cleanup, multiple Windows users and portable / nonstandard paths.
- Remaining individual-browser smoke failures/unverified entries above, plus per-browser cold native launch, all page/context actions, browser restart/update, extension disable/re-enable and uninstall cleanup beyond the passing smoke checks.
- Firefox Mozilla signing / authorized store distribution; Chromium store publication / updates if desired. These require the owner's authorized accounts and approval, not security bypasses.
- Code signing / SmartScreen reputation if a signing identity is available. No certificate was supplied here.
- Live third-party media sites, authenticated / region-restricted pages, live streams, very large multi-gigabyte files, network loss / disk-full / power interruption, antivirus interaction, proxies and real-world torrent trackers.
- Accessibility review with assistive technology, high-DPI / multiple monitors and Windows theme/scaling combinations. Responsive and keyboard tests are not a full accessibility certification.

These outstanding gates mean the deliverable must remain a **release candidate**, not be represented as fully certified or complete for every requested environment.
