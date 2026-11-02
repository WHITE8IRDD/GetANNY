<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/lockup-horizontal-white.png">
    <img src="assets/brand/lockup-horizontal-black.png" alt="GetANNY" width="420">
  </picture>
</p>

<h1 align="center">GetANNY</h1>

<p align="center"><strong>A focused Windows download manager for files, media and browser downloads.</strong></p>

<p align="center">
  <a href="https://github.com/p4yy/GetANNY/releases/latest">Download for Windows</a>
  ·
  <a href="https://github.com/p4yy/GetANNY/releases">All releases</a>
  ·
  <a href="docs/INSTALL_WINDOWS.md">Installation guide</a>
  ·
  <a href="docs/BROWSERS.md">Browser setup</a>
</p>

GetANNY brings everyday downloads into one desktop workspace. Manage file transfers, inspect supported media, keep a searchable download history, and optionally connect your browser to GetANNY.

## See GetANNY in action

<p align="center">
  <img src="assets/demo/getanny-showcase.gif" alt="Animated preview of GetANNY's download manager, media studio, browser integration and settings" width="900">
</p>

<p align="center"><sub>The download library, media studio, browser setup and settings.</sub></p>

## Download GetANNY

<sub>Current release: **2.2.6** · Windows 10/11 · 64-bit</sub>

**[Open the official GetANNY 2.2.6 release page](https://github.com/WHITE8IRDD/GetANNY/releases/tag/v2.2.6)**

Choose one Windows package:

| Package                                                                                                            | Best for                                                  |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| [Setup (.exe)](https://github.com/WHITE8IRDD/GetANNY/releases/download/v2.2.6/GetANNY-2.2.6-Setup.exe)             | Recommended for most users                                |
| [Windows Installer (.msi)](https://github.com/WHITE8IRDD/GetANNY/releases/download/v2.2.6/GetANNY-2.2.6-Setup.msi) | Managed or scripted Windows installation                  |
| [Portable (.exe)](https://github.com/WHITE8IRDD/GetANNY/releases/download/v2.2.6/GetANNY-2.2.6-Portable.exe)       | Running from a writable folder without a standard install |

Also available: [complete Windows bundle](https://github.com/WHITE8IRDD/GetANNY/releases/download/v2.2.6/GetANNY-v2.2.6-FullBundle.zip) · [SHA-256 checksums](https://github.com/WHITE8IRDD/GetANNY/releases/download/v2.2.6/checksums.txt).

**Important:** Use only one installer format. The current release binaries are unsigned. Windows may show a SmartScreen warning; review the release notes and verify the downloaded file against the published SHA-256 checksums before running it.

## Features

- **File transfers:** HTTP and HTTPS downloads with progress, speed, pause, resume, retry and a searchable local history.
- **Media Studio:** inspect supported media pages, choose available formats, and download provided subtitles or thumbnails.
- **Torrents:** add magnet links, local `.torrent` files or supported `.torrent` URLs.
- **Browser handoff:** send supported downloads from Chrome, Chromium, Edge, Brave, Firefox, Vivaldi, Opera or Helium through the matching extension. Browser installation and permissions always require your approval.
- **A configurable workspace:** 12 themes, four interface languages (including Arabic RTL), download scheduling, speed limits and tray options.

Media and torrent availability depends on the source and network. GetANNY does not bypass DRM or site access restrictions. See [release notes](docs/RELEASE_NOTES.md) for version-specific changes and [release status](docs/RELEASE_STATUS.md) for verification details.

## Getting started

1. Download one of the Windows packages from the [official release page](https://github.com/WHITE8IRDD/GetANNY/releases/tag/v2.2.6).
2. Install GetANNY, or run the portable build from a writable folder.
3. Open GetANNY and choose your download folder and preferences.
4. To use browser integration, open the in-app browser setup guide and follow the instructions for your browser.
5. Add a direct file URL or use a supported browser action to send a download to GetANNY.

See the [Windows installation guide](docs/INSTALL_WINDOWS.md) and [browser setup and troubleshooting guide](docs/BROWSERS.md) for details.

## Privacy and security

Download history and preferences are stored locally. Browser integration uses a local authenticated bridge; extension installation and permissions require your approval. Downloaded files are not run automatically. For details, see [Architecture and security contracts](docs/ARCHITECTURE.md) or report a vulnerability using [SECURITY.md](SECURITY.md).

## For developers

GetANNY is a Windows-first Electron application built with React, Vite and SQLite.

**Requirements**

- Node.js 22.22 or newer
- npm
- Windows build tools for native modules and Windows packaging

**Run locally**

```sh
npm ci
npm run prepare:tools
npm run build-extension
npm run dev
```

**Run tests and build**

```sh
npm test
npm audit --audit-level=high
npm run build:renderer
npm run build:win
```

See the project documentation for [architecture](docs/ARCHITECTURE.md), [testing](docs/TESTING.md), [Windows packaging](docs/INSTALL_WINDOWS.md), [browser integration](docs/BROWSERS.md), and [release notes](docs/RELEASE_NOTES.md).

## License

GetANNY is released under the [Apache License 2.0](LICENSE). Third-party tools and bundled components retain their respective licenses; see [third-party notices](docs/THIRD_PARTY.md).
