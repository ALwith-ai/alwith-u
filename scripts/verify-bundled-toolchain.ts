// Run on the target OS after Tauri builds. Uninstalled builds must supply their staged resource directory.
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import manifest from "../package.json"
import { assertVersion, toolchainVersions } from "./lib/toolchain"
import { deadline, removeTemporaryDirectory, stopRuntime, withCleanup } from "./lib/toolchain-cleanup"
import { ProcessRuntimeClient } from "@alwith/api/node"

const argument = process.argv[2]
if (!argument)
  throw new Error("Usage: bun scripts/verify-bundled-toolchain.ts <executable directory> [resource directory]")
const directory = resolve(argument)
// The Windows build output contains sidecars, while NSIS bundles resources from the staging directory.
const resources = process.argv[3]
  ? resolve(process.argv[3])
  : process.platform === "darwin"
    ? resolve(directory, "../Resources")
    : directory
const suffix = process.platform === "win32" ? ".exe" : ""
const versions = toolchainVersions(manifest)
const codexHome = mkdtempSync(join(tmpdir(), "alwith-u 工具链-"))

function run(name: string, args: string[]): string {
  const binary = join(directory, `${name}${suffix}`)
  const result = spawnSync(binary, args, {
    cwd: codexHome,
    env: { ...process.env, PATH: "", NODE_PATH: "", CODEX_HOME: codexHome },
    encoding: "utf8",
    timeout: 15_000
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${binary} exited ${result.status}: ${result.stderr}`)
  return result.stdout.trim()
}

const adapterVersion = await withCleanup(
  async () => {
    for (const name of ["bun", "codex", "codex-code-mode-host", "alwith-runtime", "alwith-codex-launcher"]) {
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
    const adapter = join(codexHome, "codex-acp-v2.mjs")
    copyFileSync(join(resources, "adapter/codex-acp-v2.mjs"), adapter)
    const adapterVersion = run("bun", ["--no-install", adapter, "--version"])
    if (!/^@nyssance\/codex-acp-v2 \d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(adapterVersion)) {
      throw new Error(`Unexpected packaged adapter version: ${adapterVersion}`)
    }
    const bootstrap = join(codexHome, "codex-bootstrap.mjs")
    copyFileSync(join(resources, "adapter/codex-bootstrap.mjs"), bootstrap)
    writeFileSync(join(codexHome, "gateway-models.json"), '{"models":[]}')
    await checkInitialize(bootstrap)
    return adapterVersion
  },
  () => removeTemporaryDirectory(codexHome)
)
console.log(`Packaged toolchain works without PATH: Bun ${versions.bun}, Codex ${versions.codex}, ${adapterVersion}`)

async function checkInitialize(adapter: string): Promise<void> {
  const runtime = new ProcessRuntimeClient({
    binary: join(directory, `alwith-runtime${suffix}`),
    engines: {
      codex: {
        command: join(directory, `bun${suffix}`),
        args: ["--no-install", adapter],
        env: {
          CODEX_PATH: join(directory, `alwith-codex-launcher${suffix}`),
          ALWITH_U_CODEX_PATH: join(directory, `codex${suffix}`),
          CODEX_ACP_MODEL_CATALOGS: join(codexHome, "gateway-models.json")
        }
      }
    },
    journalRoot: join(codexHome, "journal"),
    env: { PATH: "", NODE_PATH: "", CODEX_HOME: codexHome, ALWITH_MODULES_DIR: codexHome }
  })
  const exited = Promise.withResolvers<void>()
  const unsubscribe = runtime.onProcessExit(() => exited.resolve())
  let started = false
  try {
    await withCleanup(
      async () => {
        await deadline(runtime.start("codex", { engine: "codex" }), 30_000)
        started = true
        const response = await deadline(runtime.initialize("codex"), 30_000)
        const info = (response as { info?: { name?: string } }).info
        if (info?.name !== "@nyssance/codex-acp-v2") throw new Error("Packaged adapter did not initialize")
        console.log("Packaged Runtime → Bun → isolated JS adapter → Codex: ACP initialized")
      },
      () => stopRuntime(runtime, exited.promise, started)
    )
  } finally {
    unsubscribe()
  }
}
