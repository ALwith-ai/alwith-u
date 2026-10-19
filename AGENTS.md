# ALwith U

Always answer the user in Chinese.

## Product

- Independent desktop client for the Codex CLI. Codex owns every conversation
  (`~/.codex`); the app persists preferences and its own ALwith login credentials. Never add a second conversation store.
- File tree, editing and preview use the shared `@alwith/module-*` packages in a right-side workspace.
- Computer use integrates a shared host module and Cua Driver through application-wide
  tools. Codex retains reasoning and conversation ownership. The application grant applies to all sessions and forks; disabling it must revoke
  every native connection.
- Kept out on purpose: embedded browser, cloud tasks.
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
- The installed `@alwith/api` package supplies both the TypeScript client and the
  `rust/` SDK. Cargo must consume `../node_modules/@alwith/api/rust`; never add a
  Git or sibling-source dependency on `alwith-api`.
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
- Comments and documentation are English only. README, docs and other published text carry no
  internal platform planning or its terms; that planning belongs in the private Desktop repository.
- Keep `src/core` and `src/agent` free of React, Tauri and DOM assumptions.
- shadcn components only; never edit `src/components/ui/`. Add missing ones with
  `bunx --bun shadcn@latest add <name>`.
- Semantic colour tokens only. Run-state dots (red `requires_action`, yellow `running`)
  and diff +/- colours are the one sanctioned exception.
- No fallbacks for impossible states: throw. Validate only at system boundaries.
- Tests live in `__tests__/` beside the code they cover and use the in-process fake
  agent, never a child process. The runner is vitest with jsdom and jest-dom, the same
  as Desktop and Board (`vitest.config.ts`): component suites run in the `frontend`
  project (jsdom, `vitest.setup.ts` stubs), `src/agent` suites in the `engine` project
  (node) because a DOM in scope breaks the ACP stream tests. `scripts/lib` tests stay
  on `bun test` (they exercise Bun APIs).
- Pieces reduced from ALwith Desktop (`chat/composer`, `chat/dialogs`, the virtualized
  turn list, `src-tauri/src/updater`, `menu.rs`) stay recognisably Desktop's code:
  subtract, do not redesign.
- Sidecars are staged by `scripts/stage.ts`; `src-tauri/binaries/` is not committed.
  `alwith-runtime` is pinned through `@alwith/runtime` in `package.json` and staged
  from its checksum-verified platform package by default. Local Runtime builds require
  explicit `RUNTIME_SOURCE=sibling` or `RUNTIME_PATH`.

## Validate before handing back

`bun run typecheck`, `bun run test`, `bun run lint`, `bun run knip`, `bun run build`;
these are CI's gates and match ALwith Desktop's (biome + oxlint, knip for dead
code). `bun run format` before committing; formatting is not a gate. Run
`bun run test:live` (uses the user's Codex login) when touching the protocol or
turn lifecycle. In `src-tauri` when touching Rust: `cargo fmt`, `cargo clippy
--all-targets`, `cargo test --lib` (rustfmt.toml is Desktop's).

## Never bump a minor or major version on your own

- For any package or app (`@alwith/api`, `@alwith/module-*`, `codex-acp-v2`, `alwith-cli`, Desktop / U / TV) an agent may only bump the **patch** version (x.y.Z).
- Minor and major bumps are the user's decision alone; "types changed", "breaking change" or "semver convention" never justify doing it yourself. Ask first, change only after the user agrees.
- Origin: user instruction (2026-10-19; `@alwith/api` was published as 0.4.0 instead of 0.3.1 without permission, and a published version number cannot be taken back).

## Working rules

Private boundary notes (dependency and process boundaries, platform goals) live in the untracked `CLAUDE.local.md`.

## Keep pace with me in discussion

When we discuss, keep pace with me: keep trying to understand what I am thinking right now, iterate your thinking on that, and talk to me as a peer.

- When I state a new judgment, first re-derive from it, then say what it means for the architecture or plan. Do not cling to the previous round's conclusion.
- When one sentence of mine overturns an earlier assumption, immediately list the affected parts. Do not re-explain the overturned plan.
- Talk as a peer: disagree directly and give one clear recommendation. Do not flatter, and do not condescend by re-teaching what I already know.

Origin: explicit user instruction (2026-09-13).

## Derive from my premises, not from the status quo

My thinking runs ahead of existing products and industry common sense; the status quo is the old system. The mistake you keep making is importing old-system concepts as defaults and only changing after I correct you. The fix:

- Run every judgment through my premises before speaking: code is cheap, UI and business logic are tailored per person; all apps are peers, and U is ALwith's own app and a complete reference. What is shared is not only the Runtime but also complex interactions, capabilities and platform public services. Apps are the user's own programs; the Runtime does not manage users on the OS's behalf.
- Treat every concept borrowed from the status quo (SDK, plugin point, official version, template, seed, trusted surface, paternalistic safety, "verify the public interface") as an old-system artifact. Use it only if it can be re-derived from the premises; otherwise drop it.
- When unsure, push the premises to the end and give a conclusion; do not fall back to common sense. Better to overshoot and be pulled back than to stop inside the old system and wait for me to push.
- Keep the two sides apart: the Runtime side (the executor's own plugins, skills, MCP) and the app side (code level). Applying my claim to the wrong side is as wrong as importing an old concept.

Origin: explicit user instruction (2026-09-13).

## Go straight to world best, do not report gaps

When I ask "is this world best", answering "no" and then not acting is forbidden. Whatever is missing, fill it in on the spot and finish in the same turn before replying. There are only two answers: it already is, or it has been changed to be. Do not list gaps and wait for me to say "fix it". Only what cannot be done is written up, saying what cannot be done and what is missing; that is the exception, not the norm.

Origin: explicit user instruction (2026-09-13).

## Language and naming in the repository

Comments and documentation are English only. README, docs and other published text carry no internal platform planning or its terms; that planning lives in the private Desktop repository (`docs/plans`).

Origin: explicit user instruction (2026-09-30).

## Commit messages: English only, one commit per change

- Write commit messages in English only. No Chinese in subjects or bodies, in any repo.
- Squash churn before pushing: one commit per logical change. Never leave an add-then-remove sequence (a feature commit followed by its revert, or a dependency pinned and re-pinned) in history; rewrite it into the net result.
- Origin: user instruction (2026-10-20).
