// Resolve the staged Runtime and engine files; test process ownership lives in @alwith/api/node.
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

import { engineFromManifest, type RuntimeEngineSpec } from "@alwith/api/node"

const root = resolve(import.meta.dirname, "../..")
const HOST_TARGETS: Record<string, { triple: string; suffix: string }> = {
  "darwin-arm64": { triple: "aarch64-apple-darwin", suffix: "" },
  "win32-x64": { triple: "x86_64-pc-windows-msvc", suffix: ".exe" }
}

export function staged(name: string): string {
  const target = HOST_TARGETS[`${process.platform}-${process.arch}`]
  if (!target) throw new Error(`Unsupported live-test host: ${process.platform}/${process.arch}`)
  const binary = resolve(root, `src-tauri/binaries/${name}-${target.triple}${target.suffix}`)
  if (!existsSync(binary)) throw new Error(`No staged ${name} binary at ${binary}; run \`bun run stage\``)
  return binary
}

/** The chat engine as the application starts it: `engines_table` in src-tauri/src/runtime.rs. */
export function stagedCodexEngine(): RuntimeEngineSpec {
  const adapter = resolve(root, "src-tauri/resources/adapter")
  if (!existsSync(join(adapter, "engine.json"))) throw new Error("No staged chat engine; run `bun run stage`")
  return engineFromManifest(join(adapter, "engine.json"), {
    bun: staged("bun"),
    adapter: join(adapter, "codex-acp-v2.mjs"),
    codex: staged("codex")
  })
}
