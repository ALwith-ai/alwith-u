// Resolve the staged Runtime and engine files; test process ownership lives in @alwith/api/node.
import { existsSync } from "node:fs"
import { delimiter, resolve } from "node:path"

import providerCatalog from "../../src/lib/provider-catalog.json"

const root = resolve(import.meta.dirname, "../..")
const TRIPLES = ["aarch64-apple-darwin", "x86_64-unknown-linux-gnu"]

export function staged(name: string): string {
  const platform =
    process.platform === "darwin" ? "apple-darwin" : process.platform === "linux" ? "unknown-linux-gnu" : null
  const architecture = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : null
  const triple = `${architecture}-${platform}`
  if (!TRIPLES.includes(triple)) throw new Error(`Unsupported live-test host: ${process.platform}/${process.arch}`)
  const binary = resolve(root, `src-tauri/binaries/${name}-${triple}`)
  if (!existsSync(binary)) throw new Error(`No staged ${name} binary at ${binary}; run \`bun run stage\``)
  return binary
}

export function stagedCodexEngine(): {
  command: string
  args: string[]
  env: { CODEX_PATH: string; ALWITH_U_CODEX_PATH: string; CODEX_ACP_MODEL_CATALOGS: string }
} {
  const adapter = resolve(root, "src-tauri/resources/adapter/codex-bootstrap.mjs")
  if (!existsSync(adapter)) throw new Error("No staged ACP adapter; run `bun run stage`")
  const catalogs = providerCatalog.flatMap((provider) =>
    provider.catalog ? [resolve(root, "src-tauri/resources", provider.catalog)] : []
  )
  for (const file of catalogs) if (!existsSync(file)) throw new Error(`No staged model catalog at ${file}`)
  return {
    command: staged("bun"),
    args: ["--no-install", adapter],
    env: {
      CODEX_PATH: staged("alwith-codex-launcher"),
      ALWITH_U_CODEX_PATH: staged("codex"),
      CODEX_ACP_MODEL_CATALOGS: catalogs.join(delimiter)
    }
  }
}
