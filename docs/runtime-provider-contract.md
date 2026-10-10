# Native Provider and Runtime ownership

U owns one Runtime process through the Rust `alwith-api` SDK. Webviews own their subscriptions and request identities. Each connection supplies a UUID to `runtime_start` and `runtime_send`; the host rejects replaced connections and echoes that identity on replies. Closing a webview client rejects pending requests and removes subscriptions. The main native window owns application lifetime; destroying an auxiliary window preserves the Runtime, and quitting closes it with a three-second grace period.

Provider credentials belong to the native host in `runtime-providers.json`, written by private temporary-file replacement. `providers_read` and `providers:changed` return configured/region/base-URL metadata, page-defined custom providers, saved revision, applied revision, pending/applied/failed status and sanitized errors. Settings submit only explicit edits with the expected revision. Region-only and public-config-only edits preserve the native credential. No credential is read back to React or broadcast through the preference store. Existing files without custom-provider fields continue to deserialize with empty defaults.

The shared JSON catalog supplies endpoints and models to both layers. Gateway selection uses the adapter's connection-qualified model identity. Native Codex account login and gateway catalogs remain independent; no global Codex configuration is written.

The settings page owns custom-provider names, base URLs and Desktop-compatible model JSON (`label`, `api_id`, optional `contextWindow` and `description`). Rust validates these values only at its persistence boundary, stores the API key privately, maps the page model shape to the adapter catalog shape and performs the explicit paid connection probe against `<base URL>/responses`. Probe errors are classified by transport/HTTP status, truncated and scrubbed of the submitted key before reaching the webview.

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

`@alwith/api` and `@nyssance/codex-acp-v2` are installed from npm at exact versions (`package.json`, verified by the lockfile integrity hashes); the earlier vendored tarballs and `vendor/provenance.json` are gone. The installed package supplies the Rust SDK at `node_modules/@alwith/api/rust`. Runtime staging defaults to the checksum-verified npm platform package; sibling builds require explicit opt-in. The earlier verification below used an explicitly selected Runtime `7ea6a52`.

Verified on macOS arm64: 101 frontend tests, 33 Rust tests, typecheck, lint, knip, clippy and a Tauri debug app build. The real Codex live suite passed over both stdio and WebSocket, including concurrent conversations, reattach, fresh-agent replay and Runtime state queries.

Native Hasgard checks:

- `bun scripts/runtime-owner-smoke.ts <socket>`: auxiliary native window destruction preserves the same Runtime connection.
- `bun scripts/runtime-provider-smoke.ts <socket>`: on a fresh isolated U Dev provider store, the real adapter accepts credential registration, region-only update and removal; stale saves and old window writes are rejected; WebView events contain no test key or Wire frames. This script sends no model prompt.
- Closing main while the real settings window still existed left no U, Runtime, adapter or Codex process from the test instance.

For native tests, create an empty temporary `CODEX_HOME` directory before launch and set a unique `TAURI_HASGARD_SOCKET`. Never run the fresh-store provider smoke against an existing user provider store. The logged-out auxiliary settings page remains behind the normal account gate; the native checks do not assert authenticated settings-page visual behavior. Windows/Linux and release signing were not exercised by these macOS checks.

## Current artifact verification (2026-09-19)

The previous pinned SDK tarball omitted `rust/`, breaking the current Cargo path dependency. Since `@alwith/api` 0.1.7 the npm package includes the Rust distribution; U now consumes the npm release directly (0.2.1 at the time of writing), and no sibling source dependency exists.

Typecheck, frontend tests, lint, knip, frontend build and the macOS debug bundle passed with this artifact. Standard staging used npm Runtime 0.1.4, Codex 0.154.0 and adapter 0.6.0 from the pinned 440a542 artifact. The live stdio and WebSocket tests each completed two short paid Codex replies, verified concurrent session isolation, reattachment and native history replay after restarting the same engine. Both Runtime processes exited.

A separate native bundle used identifier `ai.alwith.u.smoke8521996` and an empty temporary `CODEX_HOME`. Both provider and auxiliary-window ownership smoke scripts passed. Closing main through the native macOS shortcut removed the app, Runtime, adapter and Codex processes (83339, 85449, 85450, 85461); the live WebSocket listener was also gone. The test provider store ended at revision 3 with zero credentials. Codex left lock files in its temporary directory, but no process held them. The normal ALwith sign-in gate was preserved; authenticated settings-page visual behavior remains unverified.

## Settings draft and snapshot ordering (2026-09-19)

Provider rows now submit the revision that their editable draft actually loaded. An unrelated/newer window event cannot silently rebase a dirty key or region. Untouched rows follow newer metadata; failed saves retain entered keys, and successful acknowledgements clear only the submitted draft, preserving input typed while the request was in flight. Snapshot loading and events are monotonic by saved revision; an equal-revision event keeps its newer application status instead of being overwritten by the initial read.

Three row interaction tests and three read/event ordering cases cover these boundaries. All 107 frontend tests, typecheck, lint, knip, frontend build and the isolated macOS debug bundle passed. The rebuilt `ALwith U Runtime Acceptance` instance contains these changes and remains at the normal login gate awaiting user sign-in; authenticated visual acceptance is still pending.


## ACP SDK 1.8.0

ACP v2 alpha.8 errors carry JSON-RPC details on idle frames. U reads the shared
API's `TurnError.error`; Codex-specific retry classification comes from `error.data.codex`.
Older persisted frames can still carry `_meta.codex.error`. Stop reasons without
error details remain visible. All U protocol imports use `experimental/v2`.
The coordinated change consumes the published API 0.3.0, Runtime 0.1.8 and
codex-acp-v2 0.7.8 releases. Staging copies the published adapter bundle and verifies its version.
