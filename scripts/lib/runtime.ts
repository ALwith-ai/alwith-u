// Resolve the staged Runtime and engine files; test process ownership lives in @alwith/api/node.
import { existsSync } from "node:fs"
import { resolve } from "node:path"

import providerCatalog from "@alwith/module-chat/assets/provider-catalog.json"

import { joinModelCatalogPaths } from "./model-catalog"

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

export function stagedCodexEngine(): {
  command: string
  args: string[]
  env: { CODEX_PATH: string; ALWITH_U_CODEX_PATH: string; CODEX_ACP_MODEL_CATALOGS: string }
} {
  const adapter = resolve(root, "src-tauri/resources/adapter/codex-bootstrap.mjs")
  if (!existsSync(adapter)) throw new Error("No staged ACP adapter; run `bun run stage`")
  const catalogs = [
    ...providerCatalog
      .filter((provider) => provider.id !== "anthropic")
      .flatMap((provider) => (provider.catalog ? [resolve(root, "src-tauri/resources", provider.catalog)] : [])),
    resolve(root, "src-tauri/resources/custom/models.json")
  ]
  for (const file of catalogs) if (!existsSync(file)) throw new Error(`No staged model catalog at ${file}`)
  return {
    command: staged("bun"),
    args: ["--no-install", adapter],
    env: {
      CODEX_PATH: staged("alwith-codex-launcher"),
      ALWITH_U_CODEX_PATH: staged("codex"),
      CODEX_ACP_MODEL_CATALOGS: joinModelCatalogPaths(catalogs)
    }
  }
}
