# ALwith U

An independent desktop client for the OpenAI Codex CLI. Tauri 2 shell, React UI,
the unmodified `codex` binary bundled as a sidecar. Conversations live where Codex
keeps them (`~/.codex`); the app stores nothing but a handful of preferences.

This client is Apache-2.0; the separately maintained runtime client package has its own licensing status. The runtime that owns
the agent process, the ALwith Runtime, ships as the closed `alwith-runtime` binary and is
reached through its documented stdio or WebSocket protocol.

## WorkBuddy 产品方向

ALwith U 是聊天型 WorkBuddy，也是完整参考应用。用户通过编程 Agent 写自己的 UI、增加业务能力；ALwith 提供成熟 CLI、闭源 Runtime、完整聊天、统一账号（含宠物）和统一移动端。QA、Gamepad、alwith.dev 是能力，Board 是另一种同级应用。

职责、用户流程与验收见 [WorkBuddy 目标](docs/workbuddy.md)，后续见 [实施计划](docs/plans/2026-09-13-restructure.md)。这是目标，下面的功能列表描述当前 U，不代表目标全部实现。用户应用不强制继承 U 或使用 shadcn。

Not affiliated with or endorsed by OpenAI.

## What it does

- Threads grouped by project, with archive, restore, delete and fork straight from
  Codex's own thread store
- Streaming replies in the Codex desktop look: reasoning, commands with live terminal
  output, file edits with diffs, searches, MCP calls, plans, context compaction
- Approvals inline with number-key shortcuts; MCP form elicitations in a dialog
- Model, reasoning effort, permission mode and collaboration mode per session
- Composer from ALwith Desktop: image paste and drop with previews, slash-command
  completion, per-session drafts
- Diff modal per edited file, image lightbox, find in thread (⌘F), sidebar search
- Long threads render as a virtualized window of turns that stays pinned to the bottom
- ChatGPT login, device-code login and API keys through Codex itself
- Context usage meter, desktop notifications, command palette, native menu (macOS,
  Linux), light and dark theme, English and Simplified Chinese
- Auto-update from GitHub Releases (minisign-verified), single instance, crash-safe
  error boundary
- DeepSeek, OpenRouter, Qwen and xAI models in every chat's model picker; each chat picks its own model

Deliberately left out: file tree, browser, file preview, computer use, cloud tasks.

## ALwith account

U requires an ALwith login (email code, password or email registration). It reuses
`@alwith/auth` and `alwith-auth`; Desktop is unchanged. Each application logs in
independently and stores its own tokens in its Tauri application data directory:
`auth.api.alwith.ai.json` (production) or `auth.api-dev.alwith.ai.json` (development).
No credentials are copied from Desktop. Refresh and logout affect U's login;
Codex login, provider keys and local CLI conversation history are separate.
Pets and entitlements belong to the server account ID, not these token files.
OAuth callbacks and live multi-login/pet-entitlement verification are not yet wired/verified.

## Model providers

Settings → Model providers manages Codex sign-in, sign-out and usage alongside API
keys for DeepSeek, OpenRouter, Qwen (Alibaba Model Studio, international or China endpoint)
and xAI. Each saved key registers
that provider with the adapter in catalog mode (`providers/set` with `_meta.codex.id` and
`_meta.codex.mode: "catalog"`): its models join every chat's model picker under their own
group, and a chat runs on the provider only while one of its models is selected (a Codex
per-thread `model_providers` override over the Responses API). A new chat can select a
configured provider before its first message; this does not require Codex sign-in.
Provider configuration never modifies `~/.codex/config.toml`; Codex authentication
itself remains owned by the CLI. Only providers that speak the OpenAI
Responses API natively are listed; Kimi, MiniMax and Zhipu models are reachable through
OpenRouter. Claude is deliberately not offered.

## Architecture

```
webview (React) ──alwith-runtime-v1 frames over Tauri events──▶ Rust relay ──stdio──▶ alwith-runtime ──ACP v2 stdio──▶ codex-acp-v2 ──▶ codex
                                              (closed)                      (Bun executable)   (native)
      Rust spawns alwith-runtime as a sidecar and relays frames both ways, 16 ms batches out
```

- `@alwith/api/runtime`: the transport-independent Runtime client; `@alwith/api/tauri`
  and `@alwith/api/node` connect through the desktop shell and stdio respectively.
- `@alwith/api/agent`: shared agent lifecycle and pending approval handling.
- `@alwith/api/session`: pure reducers over ACP `session/update` frames. No React.
- `src/agent/client.ts`: the Codex application adapter over these shared APIs. Routes every update by session id and
  publishes state through a zustand store; the Runtime's four-state run states
  (`running`, `requires_action`, `done`, `idle`) are mirrored alongside.
- Agent attach restores pending permissions through the shared agent API; tests use
  an in-process `AgentApp` and an in-memory fake Runtime.
- `src-tauri/src/runtime.rs`: spawns `alwith-runtime --listen stdio://` with the engine table, relays stdin/stdout
  (`codex` → `codex-acp-v2` with `CODEX_PATH`), waits for its `ready` line.
- `src/features/chat/codex/`: the Codex desktop chat look (markdown renderer,
  activity rows, work section, edited-files card, virtualized turn list, stylesheet).
- `src/features/chat/composer/`, `src/features/chat/dialogs/`: the input area and the
  dialogs, reduced from ALwith Desktop.
- `src-tauri/src/updater/`: ALwith Desktop's updater state machine over
  `tauri-plugin-updater`, fed by `latest.json` on the GitHub Release; `menu.rs` builds
  the native menu; `lib.rs` wires single-instance and kills `alwith-runtime` on exit.

## Develop

Requires Bun 1.4+, Rust stable and the Tauri 2 prerequisites for your platform.

```sh
bun install
bun run stage        # copies codex + codex-code-mode-host + alwith-runtime, compiles codex-acp-v2, writes licences
bun tauri dev
```

`stage` downloads the release pinned in `runtime.json` by default and verifies it against
the release's `SHA256SUMS`. Local development must explicitly set `RUNTIME_SOURCE=sibling`
to use a neighbouring checkout's build, or `RUNTIME_PATH` to use an existing binary.
The Runtime repository is currently private, so the download
goes through the GitHub API with `GH_TOKEN` / `GITHUB_TOKEN` or the logged-in `gh`
CLI's token; a public release repository needs no token. Bumping the Runtime is a one-line
change to `runtime.json`.

## Releases

`.github/workflows/ci.yml` runs typecheck, tests, lint and the web build on every push.
Tagging `v<version>` runs `release.yml`: six targets, sidecars staged from npm and the
pinned Runtime release, bundles uploaded to a draft GitHub Release by `tauri-action`. Apple
signing and notarisation use the `APPLE_*` secrets listed at the top of the workflow.

Updates: `createUpdaterArtifacts` signs every bundle with the minisign key whose public
half sits in `tauri.conf.json` (`plugins.updater.pubkey`); the private key goes into the
`TAURI_SIGNING_PRIVATE_KEY` secret. The app polls `releases/latest/download/latest.json`
of the repository named in `plugins.updater.endpoints`, downloads in the background and
offers a relaunch. Losing the key means shipped apps can never accept an update.

`bun run dev:tauri` runs the same thing under the identifier `ai.alwith.u.dev`
(`src-tauri/tauri.dev-instance.conf.json`), so an installed build and a dev build can
run side by side with separate preferences, logs and window state. That is how the
app develops itself: chat with Codex in the installed build, restart the dev build
freely. Both see the same Codex threads; do not open one thread in both.

`bun run stage` targets the host triple; pass a Rust target triple to stage another
platform (the matching `@openai/codex-<platform>` package must be installed).

## Validate

```sh
bun run typecheck
bun test
bun run lint
bun run build
bun run test:live    # stages sidecars; tests stdio + WebSocket with two tiny read-only chats each
bun tauri build
```

The live check uses the same client and assertions for both transports: concurrent replies,
session listing, live-agent attach, then native history replay after stopping and restarting
the agent. Test processes are cleaned up on success and failure. The four test conversations
remain in Codex's native history. For local Runtime development, rebuild the sibling Runtime
before running this check; staging copies its release binary, not its source code.

## Licence

Apache-2.0. Bundles the OpenAI Codex CLI (Apache-2.0) and
[codex-acp-v2](https://www.npmjs.com/package/@nyssance/codex-acp-v2) (Apache-2.0);
their notices ship under `resources/licenses`.
