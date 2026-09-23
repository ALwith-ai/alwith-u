// Run on the target OS after Tauri builds; paths refer to the packaged executable directory.
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import manifest from "../package.json"
import { assertVersion, toolchainVersions } from "./lib/toolchain"

const argument = process.argv[2]
if (!argument) throw new Error("Usage: bun scripts/verify-bundled-toolchain.ts <packaged executable directory>")
const directory = resolve(argument)
const suffix = process.platform === "win32" ? ".exe" : ""
const versions = toolchainVersions(manifest)
const codexHome = mkdtempSync(join(tmpdir(), "alwith-u-toolchain-"))

function run(name: string, args: string[]): string {
  const binary = join(directory, `${name}${suffix}`)
  const result = spawnSync(binary, args, {
    cwd: codexHome,
    env: { ...process.env, PATH: "", CODEX_HOME: codexHome },
    encoding: "utf8",
    timeout: 15_000
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${binary} exited ${result.status}: ${result.stderr}`)
  return result.stdout.trim()
}

try {
  for (const name of ["bun", "codex", "codex-code-mode-host", "codex-acp-v2", "alwith-runtime"]) {
    if (!existsSync(join(directory, `${name}${suffix}`))) throw new Error(`Packaged sidecar missing: ${name}`)
  }
  assertVersion("packaged Bun", run("bun", ["--version"]), versions.bun)
  assertVersion("packaged Codex", run("codex", ["--version"]), `codex-cli ${versions.codex}`)
  if (process.platform === "darwin") {
    const signature = spawnSync("/usr/bin/codesign", ["--verify", "--strict", join(directory, "bun")], {
      encoding: "utf8",
      timeout: 15_000
    })
    if (signature.error) throw signature.error
    if (signature.status !== 0) throw new Error(`Packaged Bun signature is invalid: ${signature.stderr}`)
  }
  // Exercise JS execution too: --version alone does not exercise JavaScriptCore in a signed bundle.
  assertVersion(
    "packaged Bun JS",
    run("bun", ["--eval", "console.log(Array.from({length: 10000}, (_, i) => i).reduce((a, b) => a + b, 0))"]),
    "49995000"
  )
  const adapterVersion = run("codex-acp-v2", ["--version"])
  if (!/^@nyssance\/codex-acp-v2 \d+\.\d+\.\d+$/.test(adapterVersion)) {
    throw new Error(`Unexpected packaged adapter version: ${adapterVersion}`)
  }
  console.log(`Packaged toolchain works without PATH: Bun ${versions.bun}, Codex ${versions.codex}, ${adapterVersion}`)
} finally {
  rmSync(codexHome, { recursive: true, force: true })
}
