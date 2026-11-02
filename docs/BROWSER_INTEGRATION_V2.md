# Browser integration v2: investigation, design and verification

Date: 2 November 2026  
Scope: GetANNY desktop, Chromium/Firefox extensions, EXE/MSI setup, native launcher and Windows test harness

## Executive finding

The persistent error was not a browser-specific Brave, Chrome or Firefox problem. Both Windows installers delegated browser setup to the same application helper, and that helper had a valid **successful no-op path**:

1. it started the complete GetANNY service graph (SQLite, download engines and `127.0.0.1:29615`) inside an installer custom action;
2. it registered only browsers whose executable matched the detector's finite path list;
3. if detection returned no matches, it wrote no extension package and no native host, returned an empty result, and exited successfully;
4. NSIS only printed a detail when the helper failed, while the MSI custom action used `Return="ignore"`;
5. the extension tried native messaging first and its WebSocket fallback had no automatically provisioned credential, so it could only display a registration/pairing error.

That shared helper explains why changing from MSI to EXE did not repair the connection: the package formats reached the same detection-gated registration logic and suppressed or misclassified the same outcome.

There were additional reliability gaps:

- several valid 32-bit/custom browser install locations were absent;
- only the registry view of the launching process was written;
- setup did not provision browsers installed after GetANNY;
- a generic extension ZIP could not use the already-running authenticated WebSocket until the user copied a 64-character key;
- normal startup did not repair a missing/stale setup after an application path change;
- installer setup unnecessarily competed with a running app for its database and fixed bridge port.

The native protocol framing and manifest fields in the current source are valid, and the compiled launcher has dedicated tests. Native Messaging itself was therefore not the only defect. The brittle **discovery, installer lifecycle and credential bootstrap around it** were the system-level failure.

## Selected architecture

GetANNY now uses an authenticated loopback WebSocket as its primary transport. Native Messaging remains a narrow cold-start/migration bootstrap, not a prerequisite for normal operation.

```text
Browser extension
  │
  │ browser-specific 256-bit capability
  ▼
ws://127.0.0.1:29615  (primary, direct, persistent/reconnecting)
  │
  ▼
GetANNY request validator → DownloadManager → SQLite/download engine

Generic/older extension only, first successful connection:
Browser Native Messaging broker
  → small C# launcher
  → Electron runtime in Node mode
  → authenticated loopback bridge
  → returns that browser's direct capability
  → subsequent connections use the primary path above
```

### Normal installation flow

1. EXE/MSI invokes a **standalone provisioner**. It does not open SQLite, start download engines, or bind the bridge port.
2. The provisioner prepares all eight adapters (Helium, Chrome, Chromium, Brave, Firefox, Vivaldi, Opera and Edge), whether or not executable detection succeeds.
3. Each prepared extension receives a distinct per-user, per-browser 256-bit credential in its GetANNY-owned `config.js`.
4. Native manifests/registry entries are installed as a cold-start and generic-package fallback. Both 32-bit and 64-bit registry views are covered on x64 Windows.
5. The user approves/loads the extension through browser UI. Browser security is not bypassed.
6. The extension connects directly, authenticates, completes a versioned hello, and sends requests.
7. Exponential reconnect handles desktop/service-worker restarts. If direct connection cannot reach a closed app, the native adapter can cold-start it.
8. The first packaged launch after a version or install-path change repairs GetANNY-owned integration files automatically.

A generic release ZIP intentionally contains **no embedded secret**. It can bootstrap once through the registered native adapter, then stores only its own browser credential. A browser-specific recovery key remains available as an explicit recovery path; it is no longer the normal setup path.

## Why WebSocket rather than localhost HTTP alone

Both are cross-browser and avoid browser registry lookup once provisioned. HTTP is simple for one-way `POST /add`, but GetANNY also needs desktop-to-extension commands, handoff acknowledgement, paused browser-download reconciliation, live theme/status updates and heartbeats. A WebSocket keeps those operations on one correlated bidirectional channel.

A hybrid HTTP/WebSocket API would add another parser and authentication surface without solving a current requirement. The selected protocol therefore uses WebSocket only, with native messaging as a bootstrap/cold-start adapter.

## Security model

The bridge is not an unrestricted localhost API.

- binds only to `127.0.0.1`;
- validates the WebSocket `Host` header to resist DNS rebinding;
- accepts only the fixed Chromium extension origin, a Firefox extension origin, or an originless native/local client that still possesses a capability;
- uses separate random credentials for native bootstrap, manual recovery and each browser;
- binds a provisioned credential to one browser identity during hello;
- uses timing-safe credential comparisons;
- never places a real credential in downloadable generic extension ZIPs or source control;
- limits frames to 128 KiB, pending requests per session, strings, headers and header count;
- rejects hop-by-hop/authority/range headers and CR/LF header injection;
- validates HTTP(S) download URLs again in the desktop engine;
- reports a socket as connected only after authentication and extension hello;
- forwards cookies only when the extension setting permits it and does not persist them in download history.

A process already executing as the same OS user can generally read that user's browser profile and application data. No localhost protocol can defend secrets from fully compromised same-user malware. The capability design prevents unrelated websites, extensions and ordinary local callers that do not possess the per-user secret; browser/OS account integrity remains the trust boundary.

## EZOO Download comparison

The referenced `AhmedEzo686/ezoo-download` project was inspected at commit `4091458` (1.0.8).

Useful ideas adopted:

- direct loopback communication avoids Native Messaging registration as the normal data path;
- a stable port and automatic liveness checks make extension UX simple;
- the installer keeps a stable extension folder;
- first run guides the user to browser extension approval;
- the app can remain available in the tray/startup path.

Important differences:

- EZOO uses a localhost HTTP API on port 9614 and a constant `X-SwiftGet: 1` header;
- its server accepts any `chrome-extension://`/`moz-extension://` origin and requests with no Origin;
- the constant header is not an authentication secret and can be sent by arbitrary local software;
- it is one-way request/response rather than GetANNY's correlated bidirectional handoff protocol.

GetANNY adopts the reliability pattern, not that trust model: random browser-scoped capabilities, strict Chromium origin, host validation and bounded WebSocket messages are retained.

## IDM-style comparison

The public IDM Integration Module manifest (stable extension key/ID) includes `nativeMessaging`, while community clean-room observations of current builds report a persistent localhost WebSocket as the primary channel and `com.tonec.idm` as fallback. Because IDM is proprietary, undocumented implementation details are not treated as authoritative requirements.

The relevant established patterns are:

- stable signed/store extension identity;
- long-running desktop/tray service;
- direct persistent local channel with heartbeat/retry;
- native broker as fallback/cold start rather than the only data path;
- forwarding URL, referer, user agent and narrowly scoped cookies;
- acknowledgement before cancelling the browser-owned download;
- installer repair across upgrades.

Integration v2 follows those patterns without copying proprietary code or protocol formats.

## Source-level verification added

Automated tests cover:

- migration from the old shared token to isolated stable credentials;
- provisioner processing all browsers with no executable detection dependency;
- direct setup remaining usable when native registration is blocked;
- standard manifests and a real executable launcher (no unsupported manifest `args`);
- 32-/64-bit registry writes plus browser-specific/compatibility keys;
- rejection of unauthenticated clients and untrusted website origins;
- browser-bound direct credentials and native-to-direct credential bootstrap;
- rejection of unsafe headers before the download manager is called;
- actual framed native process → authenticated bridge → persisted hash-verified file;
- direct browser extension → installed app → download/media handoff in Windows browser tests.

See `TESTING.md` and release evidence for the latest executed browser/installer matrix. A workflow definition is not test evidence.

## Remaining platform constraints

- Chromium browsers require store installation or explicit user approval for an unpacked extension. GetANNY does not silently edit profiles or force enterprise policy.
- Permanent Firefox installation requires a Mozilla-signed XPI. A temporary development add-on disappears when Firefox restarts.
- Code signing/SmartScreen reputation requires the owner's signing certificate.
- A passing GitHub Windows runner is not a pristine consumer Windows 10/11 VM and cannot replace final interactive installer/antivirus testing.
