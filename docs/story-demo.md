# Story demo (development)

A minimal end-to-end run of the story capability inside U: one story root, its frame, a dsh agent
bound to it through the story module's preset, and the ledger and notes the module keeps while the
agent runs. Development only: U does not ship dsh or the story module yet.

## What runs

- `@alwith/module-story` (a `file:` dependency on `../alwith-modules/modules/alwith-story`) is loaded by
  the Runtime from U's `node_modules` in debug builds (`ALWITH_MODULES_DIR` overrides the directory).
- The `dsh` engine is added to the Runtime's engine table when `ALWITH_U_DSH_AGENT` names a dsh-agent
  entry; it runs with `bun` from `PATH` (`ALWITH_U_BUN` overrides).
- The page asks the module for the launch (`agent/launch`), which injects the module's endpoint, the story
  root and the bundled dsh preset; U starts and drives the agent itself, as with any agent.

## Run

```sh
# once: the module binary the manifest points at (bin/ is git-ignored)
(cd ../alwith-modules && cargo build --release -p alwith-story \
  && cp target/release/alwith-story modules/alwith-story/bin/alwith-story-aarch64-apple-darwin)
rm -rf node_modules/@alwith/module-story && bun install   # file: deps are snapshots; refresh after a rebuild

DEEPSEEK_API_KEY=… ALWITH_U_DSH_AGENT=../dsh-agent/src/main.ts bun run dev:tauri
```

Then Story in the sidebar (shown only when the module is alive): Open a root, edit and save the frame,
Start agent, prompt. Every input and every piece of prose lands in the ledger with its session
provenance; `/compact` forces a compaction whose summary becomes a note that names its ledger sources.
The demo grants nothing: the sandbox is read-only and every permission request is rejected.

Headless check of the same wiring without the UI (passes without a model key; the mirror runs before the
model answers):

```sh
ALWITH_U_DSH_AGENT=../dsh-agent/src/main.ts bun scripts/story-smoke.ts
```
