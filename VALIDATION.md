# Validation — 2026-09-10

Verified on macOS (arm64) against the pinned `@nyssance/codex-acp-v2@0.3.5` and
`@openai/codex@0.154.0`.

- `bun run typecheck`, `bun test` (13 tests: in-process fake agent and fake Runtime), `bunx oxlint`
  and `bun run build` pass.
- `bun scripts/stage.ts` stages `codex`, `codex-code-mode-host` and a compiled
  `codex-acp-v2` for `aarch64-apple-darwin`; `bunx tauri build --debug --no-bundle`
  compiles the full app with the sidecars beside the binary.
- `bun scripts/live.ts` against the real Codex login: two read-only conversations
  ran concurrently and each received only its own reply; after a cold reconnect,
  `session/list` returned both threads and `session/resume` replay matched the live
  transcripts with exactly one user message each. Bundling `codex-code-mode-host`
  next to `codex` removed the "Code Mode is unavailable" notice Codex emits when
  the host is missing.

- Runtime integration: `bun test` now includes an in-memory fake Runtime proving the transport
  starts a fresh agent, and attaches (never restarts) to an agent the Runtime already runs,
  replaying its pending permission request. `bun scripts/live.ts` runs through the real
  `alwith-runtime` sidecar: two concurrent read-only conversations stayed isolated, a second
  client attached to the same running agent with the handshake answered from the Runtime's
  cache, replay matched, the Runtime journal held the session's frames, and both sessions
  ended in the Runtime's `done` state.
- The debug app launched from `src-tauri/target/debug`: `alwith-runtime`, `codex-acp-v2`
  and `codex app-server` were all running under it, the frontend logged "connected to
  @nyssance/codex-acp-v2 0.3.5, 25 threads", and all three exited with the app.
- Earlier, before the Runtime: the webview booted, Rust
  spawned `codex-acp-v2` (which spawned `codex app-server`), the frontend logged
  "connected to @nyssance/codex-acp-v2 0.3.5, 25 threads" after `session/list`,
  and both sidecars exited with the app.

Not yet verified: real file edits, approvals and elicitations through the desktop
UI (covered by the fake-agent tests at the protocol level only), Windows and Linux
staging (the platform packages are not installed here), the release bundle and
code signing, and the auto-updater (not wired yet).
