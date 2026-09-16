# ALwith U

## WorkBuddy 产品目标

平台职责以 [docs/workbuddy.md](docs/workbuddy.md) 为准。用户只定制 UI 和业务能力；CLI、Runtime、完整聊天、统一账号（含宠物）与统一移动端由 ALwith 提供。QA、Gamepad、alwith.dev 是能力，U、Board、Desktop 是同级应用。目标不等于全部已实现，本仓 UI 规则不限制用户应用的技术选型。

Always answer the user in Chinese.

## Product

- Independent desktop client for the Codex CLI. Codex owns every conversation
  (`~/.codex`); the app persists preferences and its own ALwith login credentials. Never add a second conversation store.
- Kept out on purpose: file tree, browser, file preview, computer use, cloud tasks.
  Git stays at diff review; no commit, PR or worktree features.
- Skills and plugins come from Codex's own catalogs through the adapter's `_codex/skills_*`,
  `_codex/plugin_*` and `_codex/marketplace_*` methods (`src/features/plugins`); the UI is
  Desktop's extensions page reduced. Model providers (DeepSeek, OpenRouter, Qwen, xAI;
  `src/lib/providers.ts`) are per-session gateways in the adapter's catalog mode: their
  models sit in every chat's model picker under their own group and only a chat that
  selects one runs on it. Only Responses-API providers belong in the table; never Claude. Never write `~/.codex/config.toml`; a global provider switch is
  out of the question.
- Open source under Apache-2.0. Not affiliated with OpenAI: no OpenAI or Codex
  branding that implies endorsement.
- ALwith Desktop is a sibling repo, not a parent. Do not copy its modules to maintain
  a second implementation; extract shared pieces into packages both apps consume.
  The Codex chat look under `src/features/chat/codex/` is the one deliberate import.

## Protocol

- Two boundaries, both process boundaries with versioned protocols: the Runtime
  (`alwith-runtime-v1` frames over stdio inside Tauri, WebSocket for scripts; client `@alwith/api` in the sibling `alwith-api` repo) owns the agent process;
  `@nyssance/codex-acp-v2` speaks ACP v2 for Codex. Never depend on Runtime source.
- ACP v2 only: import `@agentclientprotocol/sdk/experimental/v2`.
- The UI never consumes Codex app-server events directly. Extension methods the
  adapter exposes (`_codex/session_archive`, `_meta.codex.*`) are documented in its
  `docs/protocol.md`.
- Run states come from the Runtime (`runStates` in the store): `done` is Runtime-synthesised
  and cleared only by `markRead`. Do not derive a second unread flag in the UI.
- Route every update and action by explicit session id. Never infer a response's
  destination from the selected chat.
- Prompt responses are acceptance, not completion. State comes from `state_update`.
- Respect message upserts, tool patch semantics (omitted keeps, null clears) and
  history replay boundaries.
- ACP unions carry a `{type: string}` catch-all; narrow with the guards in
  `src/core/blocks.ts`, never with a bare `type ===` comparison.

## Code

- Bun for everything: `bun add`, `bun run`, `bunx`. No npm, pnpm or yarn.
- Keep `src/core` and `src/agent` free of React, Tauri and DOM assumptions.
- shadcn components only; never edit `src/components/ui/`. Add missing ones with
  `bunx --bun shadcn@latest add <name>`.
- Semantic colour tokens only. Run-state dots (red `requires_action`, yellow `running`)
  and diff +/- colours are the one sanctioned exception.
- No fallbacks for impossible states: throw. Validate only at system boundaries.
- Tests live in `__tests__/` beside the code they cover and use the in-process fake
  agent, never a child process. DOM tests import `codex/__tests__/dom-environment.ts`
  (happy-dom per file); never register a DOM globally, it breaks the ACP stream tests.
- Pieces reduced from ALwith Desktop (`chat/composer`, `chat/dialogs`, the virtualized
  turn list, `src-tauri/src/updater`, `menu.rs`) stay recognisably Desktop's code:
  subtract, do not redesign.
- Sidecars are staged by `scripts/stage.ts`; `src-tauri/binaries/` is not committed.
  `alwith-runtime` is pinned in `runtime.json` and downloaded with checksum verification
  by default. Local Runtime builds require explicit `RUNTIME_SOURCE=sibling` or `RUNTIME_PATH`.

## Validate before handing back

`bun run typecheck`, `bun test`, `bun run lint`, `bun run build`. Run
`bun run test:live` (uses the user's Codex login) when touching the protocol or
turn lifecycle. Run `cargo check` in `src-tauri` when touching Rust.
