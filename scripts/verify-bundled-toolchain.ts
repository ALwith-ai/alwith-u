// Run on the target OS after Tauri builds. Uninstalled builds must supply their staged resource directory.
import { spawnSync } from "node:child_process"
import { copyFileSync, cpSync, existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { engineFromManifest, ProcessRuntimeClient } from "@alwith/api/node"
import { codexArtifact, codexSidecars } from "@alwith/module-chat/stage"

import manifest from "../package.json"
import { assertVersion, toolchainVersions } from "./lib/toolchain"
import { deadline, removeTemporaryDirectory, stopRuntime, withCleanup } from "./lib/toolchain-cleanup"

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
const HOST_TRIPLES: Record<string, string | undefined> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc"
}
const triple = HOST_TRIPLES[`${process.platform}-${process.arch}`]
if (!triple) throw new Error(`Unsupported verification host: ${process.platform}/${process.arch}`)
const versions = { ...toolchainVersions(manifest), codex: codexArtifact(triple).version }
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
    // Verify sandbox helpers are packaged without provisioning the host's Windows sandbox.
    for (const name of ["bun", ...codexSidecars(triple), "alwith-runtime"]) {
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
    // Import outside the checkout so an omitted Playwright dependency cannot be
    // supplied accidentally by the developer's node_modules.
    cpSync(join(resources, "browser"), join(codexHome, "browser"), { recursive: true })
    assertVersion(
      "packaged browser tools",
      run("bun", [
        "--no-install",
        "--eval",
        'const {tools}=await import("./browser/definitions.mjs"); await import("./browser/engine.mjs"); await import("./browser/worker.mjs"); console.log(tools.some(tool => tool.name === "browser_open"))'
      ]),
      "true"
    )
    copyFileSync(join(resources, "adapter/codex-acp-v2.mjs"), adapter)
    const adapterVersion = run("bun", ["--no-install", adapter, "--version"])
    if (!/^@nyssance\/codex-acp-v2 \d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(adapterVersion)) {
      throw new Error(`Unexpected packaged adapter version: ${adapterVersion}`)
    }
    cpSync(join(resources, "adapter/alwith-docs"), join(codexHome, "alwith-docs"), { recursive: true })
    await checkInitialize(adapter, join(resources, "adapter/engine.json"))
    return adapterVersion
  },
  () => removeTemporaryDirectory(codexHome)
)
console.log(`Packaged toolchain works without PATH: Bun ${versions.bun}, Codex ${versions.codex}, ${adapterVersion}`)

async function checkInitialize(adapter: string, manifest: string): Promise<void> {
  const engine = engineFromManifest(manifest, {
    bun: join(directory, `bun${suffix}`),
    adapter,
    codex: join(directory, `codex${suffix}`)
  })
  const runtime = new ProcessRuntimeClient({
    binary: join(directory, `alwith-runtime${suffix}`),
    engines: {
      codex: { ...engine, env: { ...engine.env, TMPDIR: codexHome, TEMP: codexHome, TMP: codexHome } }
    },
    journalRoot: join(codexHome, "journal"),
    env: {
      PATH: "",
      NODE_PATH: "",
      CODEX_HOME: codexHome,
      ALWITH_MODULES_DIR: codexHome,
      ALWITH_RUNTIME_ATTENTION: join(codexHome, "attention")
    }
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
