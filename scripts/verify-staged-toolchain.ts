// Verify staged sidecars using installed filenames without building or staging them again.
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { codexSidecars } from "./lib/toolchain"
import { removeTemporaryDirectory, withCleanup } from "./lib/toolchain-cleanup"

const targets: Partial<Record<`${NodeJS.Platform}-${string}`, string>> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc"
}
const triple = targets[`${process.platform}-${process.arch}`]
if (!triple) throw new Error(`Unsupported verification host: ${process.platform}/${process.arch}`)
const root = resolve(import.meta.dirname, "..")
const suffix = process.platform === "win32" ? ".exe" : ""
const directory = mkdtempSync(join(tmpdir(), "alwith-u staged toolchain-"))

await withCleanup(
  async () => {
    for (const name of [
      "bun",
      ...codexSidecars(process.platform === "win32"),
      "alwith-runtime",
      "alwith-codex-launcher"
    ]) {
      copyFileSync(join(root, "src-tauri/binaries", `${name}-${triple}${suffix}`), join(directory, `${name}${suffix}`))
    }
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts/verify-bundled-toolchain.ts"), directory, join(root, "src-tauri/resources")],
      { stdio: "inherit", timeout: 180_000 }
    )
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Staged toolchain verification failed (${result.status})`)
  },
  () => removeTemporaryDirectory(directory)
)
