# Windows installation, build and release

## End-user installation

For the portable executable and its browser-integration limitations, see [PORTABLE_WINDOWS.md](PORTABLE_WINDOWS.md).

Requirements: Windows 10/11 x64, ordinary user account, writable destination/download folders, network access to your download sources. The standalone application includes its JavaScript runtime, native modules, yt-dlp, FFmpeg/ffprobe and native messaging launcher. Windows supplies .NET Framework 4.x for the small launcher; no separate Node.js or Python is needed.

1. Download **GetANNY Setup.exe** OR **GetANNY Setup.msi** and `SHA256SUMS.txt` from the same GitHub Release.
2. In PowerShell run `Get-FileHash '.\GetANNY Setup.exe' -Algorithm SHA256` (or the MSI path); compare with the checksum file.
3. Run the installer. Choose your install location and desktop-shortcut preference. Start Menu integration is included.
4. Open GetANNY → **Browser integration**, select your browser, and click **Set up** (the installer normally completed this already).
5. Open the browser's extension-management page and approve/load the prepared folder displayed by GetANNY. Browser consent cannot be automated safely.
6. Open the extension popup and click **Reconnect**. The prepared extension authenticates directly; a generic release ZIP securely bootstraps once through the native adapter. A verified handshake—not a copied folder or registry key—proves communication.
7. Add a direct file URL, intercept a browser download, or analyze a supported media page and choose its format in Media studio.

Unless release evidence says Authenticode **Valid**, these packages are unsigned. Branding is not signing. SmartScreen reputation warnings may occur. No certificate was provided during this session.

## Development test-build downloads

Each successful packaging step now retains a **`GetANNY-unsigned-test-build` artifact** on its Actions run, containing EXE, MSI, portable EXE, extension ZIPs, SHA-256 sums and `BUILD_STATUS.txt`. A later installed/uninstall/browser check may still be running or may fail. These artifacts are **not verified final releases**. Downloading Actions artifacts may require GitHub sign-in. The fully verified publication route requires the separate full verification gate. A specifically authorized public RC can instead publish the same immutable build with pending/failed verification prominently disclosed; its `MEASURED_RESULTS.md` and release-page warning are authoritative. Public hosting alone is not certification.

## What has actually been measured

The latest development snapshot (Windows run [40980506581](https://github.com/77worldd/GetANNY/actions/runs/40980506581), source `a863dc2`) passed 61 backend checks, 9 compiled C# launcher checks, EXE default-profile checks and actual compiled-native cold / Desktop / Start Menu launch and close checks. That job then failed in three browser tests; newer MSI default-profile lifecycle/uninstall gates were not reached. Do not mistake that failed snapshot for a certified release. A published candidate's **`MEASURED_RESULTS.md`, release notes and attached raw evidence** supersede this snapshot with actual results for its exact source commit. Interactive consumer-machine gates below remain separate.

## Scripted MSI / EXE installation

```powershell
Start-Process '.\GetANNY Setup.exe' -ArgumentList '/S','/currentuser','/D=C:\Apps\GetANNY' -Wait
msiexec /i "GetANNY Setup.msi" /qn /norestart APPLICATIONFOLDER="C:\Apps\GetANNY" ALLUSERS=2 MSIINSTALLPERUSER=1 GETANNY_DESKTOP_SHORTCUT=1
```

Use one format. Do not install EXE and MSI side-by-side: their uninstall/upgrade mechanisms differ. Browser credentials and native fallback are provisioned in **HKCU/current-user app data** for the user running setup. On x64 Windows, native-host keys are written in both 64-bit and 32-bit registry views so browser/process bitness does not decide discovery. On shared machines each user completes browser setup in their own account. No browser extension is silently installed. No enterprise policy, profile edits, credential collection or admin-only registration is used.

The installer invokes a standalone provisioner that does not open SQLite, start downloads or claim the fixed bridge port. It prepares all supported browsers even when executable detection finds none. Failures are written to `browser-setup-report.json` in the app-data directory; MSI installation fails rather than silently ignoring a failed custom action, and NSIS reports a repairable warning. Packaged startup also repairs stale version/path provisioning. The application is not falsely labeled connected until an authenticated extension hello succeeds.

## Upgrade, repair and uninstall

- Close GetANNY before upgrading. Use the same installer format and installation directory.
- SQLite migrates the existing v1 table with an additive metadata column. Settings and history are retained. Older transfers without safe entity/segment metadata may need to restart; they are not blindly appended to different files.
- Browser-scoped credentials, prepared extension files and native fallback registration are refreshed. A version/install-path marker triggers automatic repair on the next packaged start if installer setup was stale. Reload unpacked extensions on the browser extensions page to apply updated scripts. Firefox temporary add-ons must be loaded again after browser restart.
- Uninstall from Windows Settings → Apps or use the EXE uninstaller / `msiexec /x "GetANNY Setup.msi"`.
- Native-host registrations owned by this application and prepared connection files are removed. Settings/history/downloaded files are preserved intentionally. Close browsers first so native executables are not locked.
- Remove the unpacked browser add-on through each browser's UI. GetANNY cannot and does not manipulate personal browser profiles during uninstall.
- Same-version reinstall and restart preservation are automated in CI. Cross-version upgrade from the old v1 EXE, interactive UI choices, locked-browser uninstallation, and a pristine Windows VM are separate manual gates, not implied by a successful build.

## Build from source on Windows

Node 22.22+, npm, Visual Studio C++ build tools, Python for node-gyp, Windows SDK, and .NET Framework C# compiler are build prerequisites (not end-user prerequisites).

```powershell
npm ci --ignore-scripts
npm rebuild node-datachannel
npm run prepare:tools
npm run build-extension
npm test
npm audit --audit-level=high
npm run build:renderer
npm run build:win
```

The locked SQLite 13 dependency includes a Windows x64 N-API prebuild shared by Node and Electron; no legacy ABI swap is required. C++/Python tools are used only if a native dependency needs source compilation.

Outputs: `dist/GetANNY Setup.exe` and `dist/GetANNY Setup.msi`. Missing tools, mismatched pinned binary hashes or missing extension/renderer resources fail packaging. Generated binaries are ignored by Git. Do not commit `bin/` executable tools, dependencies, installers, database files or browser profiles.

For authorized signing, supply `CSC_LINK` and `CSC_KEY_PASSWORD` in the build environment / GitHub Secrets. Never put certificates or passwords into source control. CI records the real signature status. Without signing credentials, deliver unsigned binaries and disclose that limitation.

## Test installed packages

The Windows CI workflow runs `scripts/windows/test-installers.ps1` after generating real packages. Diagnostic mode `GetANNY.exe --self-test --test-user-data <isolated-folder> --report <file.json>` exercises the installed application rather than development files. It writes real files, temporarily registers a test native host for the current user, and then unregisters it. Use it only in an isolated test account; rerun normal browser setup afterward if necessary.

Automated evidence includes installed renderer/preload/IPC, HTTP/HTTPS, resume/cancel/failure, real yt-dlp / FFmpeg, local TCP torrents, C# launcher/native framing, history/restart and layout checks. A separate Playwright test loads the actual Chromium extension and verifies native-origin file and media requests reach the installed app. The runner is not a pristine Windows VM and is not proof of all browser brands.

## Releasing

On the session branch, run the **Windows installers and integration tests** workflow with `publish=true`. If the connected integration cannot dispatch Actions, an explicitly authorized push whose commit message includes the trailer `GetANNY-Publish: stable` opts into the same gated publication. Ordinary pushes build/test only; documentation-only pushes are skipped. Publication is allowed only after all gates pass. It creates a semantic-versioned official release with EXE, MSI, eight browser ZIPs (seven requested + Edge), instructions, evidence archive, checksums and GitHub's source archives. Existing tags/assets are never silently overwritten. Manual certification and Mozilla / extension-store signing are not automated by this workflow.
