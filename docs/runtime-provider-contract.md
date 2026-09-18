# Native Provider and Runtime ownership

U owns one Runtime process through the Rust `alwith-api` SDK. Webviews own their subscriptions and request identities. Each connection supplies a UUID to `runtime_start` and `runtime_send`; the host rejects replaced connections and echoes that identity on replies. Closing a webview client rejects pending requests and removes subscriptions. The main native window owns application lifetime; destroying an auxiliary window preserves the Runtime, and quitting closes it with a three-second grace period.

Provider credentials belong to the native host in `runtime-providers.json`, written by private temporary-file replacement. `providers_read` and `providers:changed` return configured/region metadata, saved revision, applied revision, pending/applied/failed status and sanitized errors. Settings submit only explicit edits with the expected revision. Region-only edits preserve the native credential. No credential is read back to React or broadcast through the preference store. There is no old preference-key migration.

The shared JSON catalog supplies endpoints and models to both layers. Gateway selection uses the adapter's connection-qualified model identity. Native Codex account login and gateway catalogs remain independent; no global Codex configuration is written.

| Boundary | Behavior |
| --- | --- |
| Save during an active turn | Persist the new revision; leave the active turn on its applied configuration. |
| Idle boundary | Serialize provider application with session/turn admission; apply the latest saved revision. |
| New turn while a saved change is pending on active turns | Report pending configuration; do not silently start under another account or queue an uncancellable prompt. |
| Apply failure | Keep the saved revision, report failed, do not acknowledge it as applied; subsequent admission retries. Error text omits upstream private payloads. |
| Concurrent settings edit | Reject a stale expected revision before changing disk or memory. |
| Region-only edit | Resolve the new endpoint with the retained native key in one candidate snapshot. |
| Provider removal | Call the adapter's disable operation; no automatic account fallback. |
| Window reload | A new connection identity rejects old writes and filters old replies, even if numerical request ids match. |
| Cancel | Bypass provider admission so stopping existing work cannot deadlock on configuration. |
| Runtime/agent replacement | Clear applied state; reapply saved configuration before subsequent session admission. |
| Last application owner exits | Close the SDK connection and reap Runtime/adapter/CLI; saved configuration remains. |

## Dependencies and verification

`vendor/provenance.json` records the source commits and SHA-256 of the two local package artifacts. These packages are installed through the lockfile; no npm publication is implied. The Rust SDK is pinned by git revision. Runtime staging still uses its explicitly selected binary source; `RUNTIME_SOURCE=sibling` was used for this verification with Runtime `7ea6a52`.

Verified on macOS arm64: 101 frontend tests, 33 Rust tests, typecheck, lint, knip, clippy and a Tauri debug app build. The real Codex live suite passed over both stdio and WebSocket, including concurrent conversations, reattach, fresh-agent replay and Runtime state queries.

Native Hasgard checks:

- `bun scripts/runtime-owner-smoke.ts <socket>`: auxiliary native window destruction preserves the same Runtime connection.
- `bun scripts/runtime-provider-smoke.ts <socket>`: on a fresh isolated U Dev provider store, the real adapter accepts credential registration, region-only update and removal; stale saves and old window writes are rejected; WebView events contain no test key or Wire frames. This script sends no model prompt.
- Closing main while the real settings window still existed left no U, Runtime, adapter or Codex process from the test instance.

For native tests, create an empty temporary `CODEX_HOME` directory before launch and set a unique `TAURI_HASGARD_SOCKET`. Never run the fresh-store provider smoke against an existing user provider store. The logged-out auxiliary settings page remains behind the normal account gate; the native checks do not assert authenticated settings-page visual behavior. Windows/Linux and release signing were not exercised by these macOS checks.
