# FINAL BUILD HANDOFF — GetANNY v2.4.7

Read this file first. Package the delivered working tree. Do not refactor processing, repeat architecture investigation, run tests, export sample videos, benchmark, install the application, publish to GitHub, or create/push Git tags. The owner will test the delivered app. v2.4.7 is the intended release identifier; no Git tag has been created. Existing desktop EXEs and ZIPs predate this trimming implementation and MUST be replaced by a fresh build.

## Implementation and status

New: `src/main/media/VideoTrimmer.js`. Uses asynchronous, hidden FFmpeg/ffprobe subprocesses with bounded log capture and AbortSignal cancellation. Downloads complete selected source streams through the existing yt-dlp wrapper, then input-side accurate seeking decodes from the preceding keyframe and discards preroll. Fractional seconds are passed directly to FFmpeg. Only the chosen duration is encoded. Source and processing files stay in the existing private job directory. A small ffprobe check in the application rejects missing video and durations outside max(120 ms, two nominal frames), with a 250 ms fallback for unknown rates. This is a runtime guard implemented in code, not a test run performed by the agent. Only completed output is published through existing reservation/publish logic. No frame scanning pass is used.

Modified:
- `src/main/media/YtDlpWrapper.js`: removes rounded, network-side `--download-sections` / `--no-force-keyframes-at-cuts` cutting. Whole-file downloads remain unchanged.
- `src/main/media/MediaEngine.js`: invokes local trimming after validated source-path reporting; connects processing progress, pause/cancel, output validation and publication.
- `src/renderer/components/VideoSegmentSelector.jsx`: millisecond input/display/range retention; existing minimum selection remains one second.
- `src/shared/locales/en.json`: describes source download followed by precise encoding.
- `scripts/windows/assemble-branded-bundle.js`: obtains eight extension ZIPs from dist-extension, corrects updater alias URLs, includes this handoff, supports explicit `--allow-missing-msi` (no substitute MSI).

Encoding decisions: MKV; H.264/libx264 CRF 16 veryfast for SDR, HEVC/libx265 CRF 16 veryfast for PQ/HLG; FLAC audio. Original pixel format and basic range/primaries/transfer/matrix are requested; unsupported encoder pixel formats fail explicitly. No forced output frame rate or resizing. VFR timestamps use passthrough. Four video threads; x265 pools limited to four with two frame threads to limit contention. Source first audio track is included if available. Chapters and subtitles are not carried into the cut. Dynamic HDR/Dolby Vision, mastering metadata, auxiliary streams and all exotic pixel/audio layouts are not guaranteed. Video is high-quality lossy re-encoding, NOT bit-identical. FLAC preserves supported decoded PCM, not the original audio bitstream. Precision is limited to source frames/audio samples. Downloading a complete source requires its network time and temporary disk space; this implementation does not claim fastest market performance or ranged-source downloading. Hardware acceleration and smart rendering were not added.

No test suite, FFmpeg export, benchmark, app launch, or build was run for this implementation. Only source inspection/static review was performed. Older tests asserting network keyframe-copy cutting describe the old behavior; do not report them as passed. Runtime correctness, codecs supported by the pinned binaries, HDR playback, A/V sync and speed remain for owner testing.

## Exact inputs and dependencies

Keep package.json AND package-lock.json; use locked dependencies. Windows x64; Node >=22.12.0 (Electron package requirement), npm, Git, Windows PowerShell, Windows tar.exe. For Store assets: Python 3 with Pillow (generate-store-assets.py imports PIL; its version is not pinned). Native host compilation uses `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`, System.Web.Extensions.dll, scripts/windows/NativeHost.cs, assets/icon.ico.

Lockfile versions inspected: Electron 45.2.1, electron-builder 26.18.0, better-sqlite3 13.0.3, webtorrent 3.0.21, node-datachannel 0.32.3, utp-native 2.5.3, ws 8.22.1, Vite 6.4.5, React 18.3.1, fflate 0.8.3. Full transitive version inventory is package-lock.json; no new npm dependency is required for trimming. Do not upgrade them. Existing native modules are present in this working tree. If reinstalling node_modules is genuinely required, use npm ci (postinstall runs electron-builder install-app-deps), and report any native build blocker. npmRebuild:false is intentional in electron-builder.yml.

Bundled external tools in `bin/`: yt-dlp.exe (manifest release 2026.10.26), ffmpeg.exe and ffprobe.exe (manifest b6.1.1), GetANNY.NativeHost.exe, FFmpeg-LICENSE.txt, FFmpeg-SOURCE.txt. Preserve all. scripts/tools-manifest.json pins tool hashes and download origins. The trim requires libx264, libx265, FLAC encoders, Matroska muxing and ffprobe; no tool capability scan has been run in this implementation. Do not silently swap binaries or bypass checksum checks. These are standalone EXEs; no additional FFmpeg DLLs are declared by this repository. bin/aria2c.exe and its licenses also exist from earlier changes but are not used by the active WebTorrent engine or included by electron-builder.yml's bin filter; do not invent an aria2 dependency for trimming.

Resources selected by electron-builder.yml:
- ASAR: src/main/** (excluding *.test.js), src/shared/**, package.json, dist-renderer/**, assets/icon.png, assets/tray-icon.png, LICENSE, docs/THIRD_PARTY.md; production dependency closure resolved by electron-builder.
- Loose resources/native-host/: native-host.js and DesktopExitMarker.js from src/main/browser-integration; ws package.json, index.js and lib/**.
- Loose resources/bin/: tools and notices listed above.
- Loose resources/extension/: all dist-extension/** (generated Chromium/Firefox manifests, scripts, icons and packages).
- Native ASAR-unpacked files: node_modules/better-sqlite3/prebuilds/win32-x64.node; node_modules/node-datachannel/build/Release/node_datachannel.node; node_modules/utp-native/** including prebuilds/win32-x64/node.napi.node.
- Build assets: assets/icon.ico, icon.png, tray-icon.png, appx/** for Store, renderer fonts/assets under public and assets. Preserve complete assets/ and public/ directories.
- Configuration/hooks: electron-builder.yml, vite.config.js, index.html, scripts/verify-package.js, scripts/verify-installed-resources.js, scripts/tools-manifest.json, scripts/windows/customize-msi.js, scripts/windows/installer.nsh. Both package hooks inspect required resources/hashes; they are packaging integrity checks, not runtime tests. Do not disable them.

No new environment variable is required. ELECTRON_RUN_AS_NODE=1 is set inside the existing yt-dlp wrapper for its JS runtime; do not globally set it when launching the desktop app. Network access to GitHub and electron-builder download sources is required on cold caches. No signing certificate is configured: builds are unsigned. No GitHub token is required for --publish never. Do not use the publishing scripts.

## Build once from the delivered sources

Run in the project root using the existing dependencies. Do not run npm ci unnecessarily.

```powershell
# Only if bin tools/native host are genuinely missing:
npm run prepare:tools
# Build current renderer, extensions, NSIS, MSI and portable:
npm run build:win
# Then optional requested Store AppX (requires Python + Pillow):
npm run build:win:store
```

`npm run dist` is exactly build:win followed by build:win:store. build:win runs build-extension, build:renderer, then electron-builder --win nsis msi portable --publish never. Store runs those frontend steps again, generates assets/appx, then electron-builder --win appx --x64 --publish never. For avoiding duplicate frontend generation, after successful build:win use `python scripts/windows/generate-store-assets.py` then `npx electron-builder --win appx --x64 --publish never`.

Known real prior blockers: restricted-network ENOTFOUND github.com was resolved with network-enabled execution. Prior MSI failed WiX light.exe LGHT0103 because its temporary MSI disappeared during linking/validation; do not claim it succeeded or reuse v2.4.5 binaries. If this recurs, report it. Produce successful NSIS + portable separately using `npx electron-builder --win nsis portable --publish never`. The explicit assembly fallback below permits a truthful bundle lacking MSI. Do not disable WiX validation or manufacture an MSI. Store has not been built in this session.

Expected dist files: GetANNY Setup.exe; GetANNY Setup.exe.blockmap; latest.yml; GetANNY Setup.msi if successful; GetANNY Portable.exe; GetANNY Store.appx if successful; win-unpacked/GetANNY.exe and complete resources/runtime closure. Retain the full unpacked directory if delivering it; the executable alone is insufficient.

## Assemble release structure

After successful build outputs exist:

```powershell
node scripts/windows/assemble-branded-bundle.js --desktop
# Only with an acknowledged MSI failure:
node scripts/windows/assemble-branded-bundle.js --desktop --allow-missing-msi
```

Do NOT use scripts/windows/assemble-release.ps1: that script requires installer/browser runtime test evidence that the owner explicitly did not authorize here. Do not invoke scripts/windows/publish-owner-build.ps1 or publish-existing-candidate.js.

Assembly writes release-assets/GetANNY-2.4.7-Windows-Release/ and release-assets/GetANNY-2.4.7-Windows-Bundle.zip, copies the folder to Desktop/GetANNY-v2.4.7-Release and ZIP to Desktop/GetANNY-2.4.7-Windows-Bundle.zip. It creates release-assets/SHA256SUMS.txt and standalone versioned installer/portable/optional AppX/updater aliases. Desktop writes may require sandbox escalation; authorized by the owner. Do not change the version or create a remote release.

ZIP inventory (version is from package.json):

```text
GetANNY-2.4.7-Windows-Release/
  VERSION.txt
  Installers/
    GetANNY-2.4.7-Setup.exe
    GetANNY-2.4.7-Setup.msi       [only successful real MSI]
    GetANNY-Setup.exe
    GetANNY-Setup.exe.blockmap
    latest.yml
  Portable/GetANNY-2.4.7-Portable.exe
  Browser_Extensions/
    GetANNY-brave-2.4.7.zip
    GetANNY-chrome-2.4.7.zip
    GetANNY-chromium-2.4.7.zip
    GetANNY-edge-2.4.7.zip
    GetANNY-firefox-2.4.7.zip
    GetANNY-helium-2.4.7.zip
    GetANNY-opera-2.4.7.zip
    GetANNY-vivaldi-2.4.7.zip
  Setup_Helpers/
    Setup-Browsers.ps1
    Setup-Browsers.cmd          [generated by assembly]
    NATIVE_MESSAGING.md
  Documentation/
    START_HERE.md              [from docs/WINDOWS_BUNDLE.md]
    INSTALL_WINDOWS.md
    BROWSERS.md
    PORTABLE_WINDOWS.md
    RELEASE_NOTES.md
    RELEASE_STATUS.md
    CHANGELOG.md
    THIRD_PARTY.md
    PACKAGED_RUNTIME_STATUS.md
    LICENSE
    RELEASE_INFO.md            [generated, identifies working tree and MSI availability]
    FINAL_BUILD_HANDOFF.md
  Checksums/SHA256SUMS.txt      [generated from actual bundle files]
  MicrosoftStore/
    GetANNY-2.4.7-Store.appx     [only successful real AppX]
    STORE-README.txt            [generated only with AppX]
  ThirdPartySource/             [directory reserved by existing assembler]
```

The previous public release was v2.4.5; its bundle layout informed this structure. This build uses v2.4.7 binary identity. Do not copy libtorrent-LICENSE.txt from the old release: current active engine is WebTorrent, and no current libtorrent dependency is declared. Preserve bin FFmpeg notices inside the packaged app. Existing documentation may describe older measured results; these do not establish correctness of the new trim implementation. No source archive, runtime test report, MSI, Store package or certificate should be fabricated.

## Next agent scope

Read FINAL_BUILD_HANDOFF.md first; build the existing v2.4.7 implementation once, preserve all native/FFmpeg resources and licenses, then run the named assembly script for the versioned desktop folder and ZIP. Handle only genuine packaging blockers; do not rewrite completed processing logic, repeat architectural work, run tests, export samples, or publish to GitHub. Report precisely which installers were generated and any missing MSI/AppX. All real-world testing belongs to the owner. Earlier desktop bundles are stale relative to this source update.
