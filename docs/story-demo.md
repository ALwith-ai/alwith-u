# Story demo (development)

A minimal end-to-end run of the story capability inside U: one story root, its frame, a dsh agent
bound to it through the story module's preset, and the ledger and notes the module keeps while the
agent runs. Development only: U does not ship dsh or the story module yet.

## What runs

- The story module (`alwith-modules/modules/alwith-story`) is not a dependency of U; installs must not need a
  sibling checkout. The Runtime loads it from whatever `ALWITH_MODULES_DIR` points at (debug builds default to
  U's `node_modules`, where it is absent unless staged there).
- The `dsh` engine is added to the Runtime's engine table when `ALWITH_U_DSH_AGENT` names a dsh-agent
  entry; it runs with `bun` from `PATH` (`ALWITH_U_BUN` overrides).
- The page asks the module for the launch (`agent/launch`), which injects the module's endpoint, the story
  root and the bundled dsh preset; U starts and drives the agent itself, as with any agent. Its sidebar and
  palette entries are currently hidden; the source is kept for reactivation.

## Stage the module

```sh
modules=$(mktemp -d)/modules && mkdir -p "$modules/@alwith/module-story/bin"
(cd ../alwith-modules && cargo build --release -p alwith-story \
  && cp -R modules/alwith-story/{alwith-module.json,package.json,dsh-preset} "$modules/@alwith/module-story/" \
  && cp target/release/alwith-story "$modules/@alwith/module-story/bin/alwith-story-aarch64-apple-darwin")
```

## Headless check

```sh
ALWITH_MODULES_DIR=$modules ALWITH_U_DSH_AGENT=../dsh-agent/src/main.ts bun scripts/story-smoke.ts
```

Without `DEEPSEEK_API_KEY` it checks the wiring only: the module loads, the launch carries the preset, and the
prompt is mirrored into the ledger with its session (the mirror runs before the model answers). With a key it
also runs two real turns and `/compact`, and requires the answers as prose in the ledger and the compaction
summary as a note whose sources are ledger entries. Every model failure shows up in the dsh session log as an
`assistant/attempt` with the provider's error; a turn that fails still ends idle, so the ledger assertions are
what catch it.
