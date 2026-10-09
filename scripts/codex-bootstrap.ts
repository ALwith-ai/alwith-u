// U owns startup caching. The ACP adapter is imported unchanged from its published package.
import { spawnSync } from "node:child_process"
import { isAbsolute } from "node:path"
import { prepareModelCatalog } from "./lib/model-catalog"

async function start(): Promise<void> {
  const command = process.env.ALWITH_U_CODEX_PATH
  if (!command || !isAbsolute(command)) throw new Error("ALWITH_U_CODEX_PATH must name the bundled Codex executable")
  const probe = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 10_000 })
  if (probe.error || probe.status !== 0)
    throw new Error(`Codex version probe failed: ${probe.error?.message ?? probe.stderr}`)
  const catalog = prepareModelCatalog({ command, prefixArgs: [], shell: false }, process.env, probe.stdout.trim())
  if (catalog.path === null) delete process.env.ALWITH_U_CODEX_CATALOG
  else process.env.ALWITH_U_CODEX_CATALOG = catalog.path
  process.once("exit", catalog.dispose)
  process.stdin.once("end", catalog.dispose)
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143]
  ] as const) {
    process.once(signal, () => {
      catalog.dispose()
      process.exit(code)
    })
  }
  try {
    // A runtime URL keeps the unmodified adapter out of this bundle.
    const adapter = new URL("./codex-acp-v2.mjs", import.meta.url).href
    await import(adapter)
  } catch (error) {
    catalog.dispose()
    throw error
  }
}
await start()
