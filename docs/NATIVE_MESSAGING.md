# Native messaging: bootstrap and cold-start fallback

Native Messaging is no longer GetANNY's normal browser data path. See [BROWSER_INTEGRATION_V2.md](BROWSER_INTEGRATION_V2.md) for the investigation and selected architecture.

The EXE and MSI installers provision a browser-specific authenticated loopback credential and stable extension folder for every supported browser. Once that prepared extension is approved/loaded, it connects directly to `127.0.0.1:29615` and automatically reconnects without registry discovery.

The installers still include and register `GetANNY.NativeHost.exe` for two narrow cases:

1. cold-start GetANNY when a generic/older extension cannot reach the desktop; and
2. securely bootstrap a generic extension with its browser-specific direct credential.

The launcher is a real compiled C# executable because native-host manifests do not support an `args` field. It reads its adjacent per-user configuration, starts the installed Electron runtime in Node mode, relays standard native-message framing and authenticates to the loopback bridge with a credential that is distinct from every browser credential. No external Node.js installation is required.

Installer setup provisions all browsers and both Windows registry views; it is not gated on executable detection. Loading/enabling the extension still requires browser consent. GetANNY does not write browser profiles or enterprise policy.

Recovery command:

```powershell
& "C:\path\to\installed\GetANNY.exe" --setup-browser-hosts --quiet
```

Use the installed app, not the portable launcher. The standalone helper does not start SQLite, download engines or the bridge server, so it can run during install/repair while the desktop is open. Results are written to `browser-setup-report.json` under the current user's GetANNY app-data directory.

A generic release extension contains no secret. If both direct provisioning and native bootstrap are unavailable, reveal that browser's recovery key in **GetANNY → Browser integration**, paste it into **Connection & pairing**, and reconnect. Treat all bridge credentials as passwords; never share or commit them.
