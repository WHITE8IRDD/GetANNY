# Third-party notices and tool provenance

GetANNY source: Apache License 2.0 (root LICENSE). JavaScript dependencies retain their own package licenses; installers bundle required production modules, not a relabeled proprietary engine.

## yt-dlp

- Project / source / licenses: https://github.com/yt-dlp/yt-dlp
- Pinned version: **2026.10.26**. Official platform assets and SHA-256 digests are recorded in `scripts/tools-manifest.json` from the official release asset digests.
- The upstream source is generally Unlicense, with separately identified bundled components / standalone executable licensing described by that release. Consult the upstream license files for the distribution used.
- The default build refuses an unverified or missing tool instead of substituting an old unrelated executable. The restricted Linux development workspace used the same yt-dlp version from PyPI; that is not a Windows packaging fallback.
- yt-dlp uses the installed Electron runtime in Node mode for supported JavaScript challenges. No developer Node installation is assumed in the packaged Windows application. Live site compatibility still needs testing.

## FFmpeg / ffprobe

- Build distribution: https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1
- Upstream FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/n6.1.1
- Distribution build/source instructions: https://github.com/eugeneware/ffmpeg-static (see the corresponding release and upstream build notes).
- Pinned platform binaries / hashes: `scripts/tools-manifest.json`.
- Preparation includes upstream `FFmpeg-LICENSE.txt` and `FFmpeg-SOURCE.txt` beside the executables. They are separately executed tools, not linked into GetANNY's source.
- FFmpeg builds can be GPL depending on enabled components. Redistribution retains the upstream license and corresponding source/build references; no claim is made that FFmpeg is Apache-licensed or authored by GetANNY. Distributors must honor the exact build's GPL/LGPL obligations, including making corresponding source available where required.
- This is a pinned build rather than a claim of “latest FFmpeg”. Review / update tools and hashes deliberately as upstream security releases become available. Tool pinning and npm audit are not a full binary security audit.

## Cairo font

- The Cairo variable font is bundled in `src/renderer/assets/fonts/Cairo-Variable.ttf` and distributed with the renderer. It is used for Arabic UI text; users do not need to install it separately.
- Source: https://github.com/google/fonts/tree/main/ofl/cairo
- License: SIL Open Font License 1.1, included in the packaged renderer as `fonts/OFL-Cairo.txt`.

## Other components

## aria2

The Windows bundle includes aria2 1.37.0. Its license notices are supplied as `ARIA2-COPYING.txt` and `ARIA2-OPENSSL-LICENSE.txt`; the corresponding source archive is included at `ThirdPartySource/aria2-1.37.0-source.zip`. Upstream: https://github.com/aria2/aria2.

Electron (MIT / Chromium third-party notices), React (MIT), better-sqlite3 (MIT) / SQLite (public domain), WebTorrent and related modules (MIT / package licenses), ws (MIT), React Icons (individual icon licenses, see its package), content-disposition (MIT), Zustand (MIT), and build/test tools retain their upstream licenses. Electron's platform license/notices files are shipped by electron-builder.

The Chromium manifest key is a public key used solely for a stable extension ID. No private signing key, store credential, browser profile or per-user pairing secret is committed.
