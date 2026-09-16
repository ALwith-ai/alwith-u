# Changelog

## 0.1.0 (unreleased)

Rebuilt from the browser MVP into a Tauri 2 desktop app.

- The agent process is owned by the ALwith Runtime (`alwith-runtime` sidecar, closed) and
  reached through the open `@alwith/api` client: a webview reload re-attaches to
  the running agent, gets its pending permissions back and replays the handshake from
  the Runtime's cache; the Runtime's `done` state and global `markRead` drive the sidebar

- Tauri shell with `alwith-runtime`, `codex`, `codex-code-mode-host` and a compiled
  `codex-acp-v2` bundled as sidecars; `alwith-runtime` is pinned in `runtime.json` and
  downloaded from its release with checksum verification when built without the Runtime source
- CI (typecheck, tests, lint, web build) and a six-target release workflow
- One ACP v2 client for every session, backed by an immutable session reducer and
  a zustand store
- Threads listed from Codex's own store, grouped by project; archive, restore,
  delete and fork
- Codex desktop chat look: markdown, reasoning, command cards with terminal output,
  diffs, edited-files card, plans, compaction markers, turn errors
- Reduced from ALwith Desktop: the input area (image paste/drop, slash completion,
  model/effort/mode selects), form-elicitation dialog, diff modal, image lightbox,
  find in thread, sidebar search, virtualized turn list, native menu, single instance,
  error boundary, GitHub-Releases auto-updater with minisign verification
- alwith-runtime crash recovery: the port is reset and Reconnect starts a fresh process
- Model providers (DeepSeek, OpenRouter, Qwen, xAI): an API key per provider in Settings
  puts its models into every chat's model picker under its own group; each chat picks its
  own model and nothing global changes
- Composer with image attachments, slash commands, per-session model, reasoning
  effort, permission mode and collaboration mode
- Inline approvals and MCP form or URL elicitations
- ChatGPT, device-code and API-key login through Codex
- Context usage meter, desktop notifications, command palette, settings, themes,
  English and Simplified Chinese
