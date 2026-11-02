# Architecture and lifecycle contracts

## Processes

- Electron main owns services, SQLite, filesystem/shell, native dialogs and validated IPC.
- Sandboxed/context-isolated renderer uses a fixed preload allowlist. IPC checks the actual main frame/sender; no generic filesystem or shell execution API is exposed.
- `createServices` composes bounded asynchronous HTTP streams, media and torrent engines, cached completion previews, validated settings, browser tooling and the local bridge. The explicit Vite-only preview reuses these services with an isolated database and returns errors for desktop-only actions.
- The primary browser transport is a provisioned, authenticated loopback WebSocket. The Windows native launcher is a compiled C# bootstrap/cold-start fallback. It relays standard I/O to the installed Electron runtime with `ELECTRON_RUN_AS_NODE=1`, which runs the JS framing bridge. Native manifests contain executable path, stdio type and exact extension allowlist—not unsupported argument fields.

## Transfer states

`paused / queued → connecting → downloading → processing → completed`, or `failed / retrying / cancelled`. Slots count active engines until their start promise settles. Pause/cancel must await streams/process trees before a new engine is allowed to write the same job's partials. Queue insertion and manual retry are idempotent for active jobs.

- HTTP: capability probe uses an actual range response. Entity ETag / Last-Modified / total size and segment layout are persisted next to ID-scoped partials. Exact Content-Range, length and final stat are verified. Unknown total remains unknown until end of stream. Atomic same-directory hard link fails if an existing target appears; no overwrite.
- Segments use bounded-memory asynchronous streams rather than one worker thread per range. A single capability request replaces the old HEAD-plus-range sequence when possible. Bounded keep-alive agents reuse connections without imposing a speed limit. Throttle requests go to one per-transfer limiter, so parallel connections do not multiply the configured speed limit. On sibling failure streams are stopped and awaited. Assembly streams parts, then validates final byte count.
- Media: full job IDs isolate output and partial cleanup (never a shared eight-character prefix). A recent analyzed selection generates the yt-dlp format selector. Machine-readable progress is streamed, audio merging requires FFmpeg, and final completion requires successful process exit plus an actual nonempty reported file inside the expected destination. Pause uses continuation files; some websites cannot resume and may restart. Analysis retains at most 20 entries for 30 minutes and exposes only legitimately returned descriptions, tags, thumbnail renditions and manual/automatic caption catalogs. Independent and alongside-video subtitles use the same managed queue; SRT/VTT conversion requires FFmpeg when the source does not directly provide the requested format.
- Torrents: per-job WebTorrent clients use an ID-isolated destination folder, verify pieces and persist data on pause; resume reopens/rechecks files. Completion stops seeding. Cancellation stops the client but retains verified pieces; torrent directories are never recursively deleted by a generic file/history action. A local TCP transfer is an installed-app CI gate; no public-tracker speed claims are made.

## SQLite / preferences

WAL + busy timeout; v1 additive migration to `metadata`. Prepared hot-path statements are reused. Renderer progress is batched at 150 ms and persistence at 2 seconds, with terminal/shutdown flushing. Core searchable columns stay intact; structured metadata retains explicit names, real output paths, media selection, browser transfer identity, completion time, retry state and validated transfer information. Settings use JSON values with an allowlist, type/range/path validation and actual runtime consumers. Connection / per-download rate changes apply on new/resumed jobs; concurrency and browser enablement take effect immediately.

No passwords or tokens are logged. Per-user bridge identity and native configuration are local app-data files, never source files. Unix files are mode 0600 / executable launcher 0700; Windows relies on the current user's app-data ACL. The checked-in extension key is **public** and fixes extension ID; it is not a signing key.

## Browser protocol

1. A prepared extension opens `ws://127.0.0.1:29615` with its browser-specific 256-bit credential. A generic/legacy extension can ask the authenticated native adapter for that direct credential once and persist it locally; explicit recovery-key entry is the final fallback.
2. Extension sends `hello` with protocol version 2, configured browser ID, stable extension ID and version. The server binds the credential to that browser identity and tracks actual heartbeat recency; a bare socket never counts as connected.
3. After bootstrap, the persistent WebSocket is the primary path. Exponential retry reconnects it after extension service-worker, browser or desktop restart. Native Messaging is retained only for secure bootstrap and cold start.
4. Download requests carry a request ID. File requests are queued or explicitly acknowledged as **review**; media requests are acknowledged as **analyze**, not fake download success.
5. Ordinary intercepted requests also carry a browser transfer ID, available filename/cookies/referer/user-agent metadata and an intercepted marker. The browser pauses first. Accepted desktop IDs and pending reviews are deduplicated by source/transfer ID; `download-status` reconciles ambiguous reconnects. Main-to-extension commands cancel or resume only the matching native entry.
6. Definitive request failure resumes native. Unpausable and private transfers remain native. Accepted transfers never deliberately resume the browser copy after cleanup failure. Reviews remain paused across temporary disconnection; dismissal/resume, acceptance/cancel, or clean desktop shutdown resolves them.
7. A matching response or clear timeout/error reaches the popup / media action. URLs and protocol are validated again at the manager boundary.

The WebSocket binds loopback, validates `Host` and origin, uses timing-safe authentication, bounds payload/header/string counts, rejects browser/credential mismatches and unauthenticated requests, limits pending confirmations, and serializes requests per session. Browser, native and recovery credentials are separate. It is not a remotely exposed or unrestricted localhost backend. The development preview uses same-origin relative requests to Vite and is not included in production.

## Completion previews

Only completed regular files are eligible. Visible rows request previews lazily through validated IPC. Electron's OS thumbnail API is preferred; bounded FFmpeg frame extraction supports images, video and audio cover art when OS thumbnails are unavailable. A SHA-256 key includes path, size, mtime and thumbnail version. Generation is serialized, child processes are stopped on shutdown, files are written atomically, IPC responses are capped at 300 KiB, and disk pruning bounds the cache to 500 files / 64 MiB. The renderer retains at most 100 small data URLs. Full media files are never read into renderer memory; unsupported formats retain their normal icon.

## Shutdown and packaging

An asynchronous Electron shutdown guard stops the bridge and awaits engines before closing SQLite. Tray-close behavior is honored only when a tray actually exists. Builders require renderer, both extension manifests, native modules, tools, licenses and a real Windows launcher. A standalone installer helper prepares direct credentials/folders for all targets and registers native fallback in HKCU across both Windows registry views without opening SQLite or binding the bridge port. Packaged startup repairs stale version/path provisioning. No browser policy or profile edits are used. Uninstall removes only registrations/files owned by the app and preserves history/downloads. Browser-side add-ons must be removed through browser UI.

## Processing progress is not published completion

After all HTTP segments are verified, processing snapshots expose the exact network byte count, zero network speed and unknown ETA. Output remains unpublished until assembly, final stat/length checks and atomic no-overwrite publication succeed. The regression asserts both truthful processing progress and absence of a completed destination at that boundary.
