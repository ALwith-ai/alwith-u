import { expect, test } from "bun:test"
import { join } from "node:path"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

const HOST_TRIPLES: Partial<Record<`${NodeJS.Platform}-${string}`, string>> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc"
}

test("the staged toolchain runs with explicit resources outside the executable directory", () => {
  const triple = HOST_TRIPLES[`${process.platform}-${process.arch}`]
  if (triple === undefined) return

  const stage = Bun.spawnSync([process.execPath, "scripts/stage.ts", triple], {
    cwd: join(import.meta.dir, "../../.."),
    stdout: "ignore",
    stderr: "pipe",
    timeout: 45_000
  })
  expect(stage.exitCode, stage.stderr.toString()).toBe(0)
  expect(readFileSync(join(import.meta.dir, "../../../src-tauri/resources/adapter/codex-acp-v2.mjs"))).toEqual(
    readFileSync(join(import.meta.dir, "../../../node_modules/@nyssance/codex-acp-v2/dist/index.js"))
  )

  const suffix = process.platform === "win32" ? ".exe" : ""
  const directory = mkdtempSync(join(tmpdir(), "alwith-u 适配器-"))
  try {
    const entry = join(directory, "codex-acp-v2.mjs")
    copyFileSync(join(import.meta.dir, "../../../src-tauri/resources/adapter/codex-acp-v2.mjs"), entry)
    const adapter = Bun.spawnSync(
      [join(import.meta.dir, `../../../src-tauri/binaries/bun-${triple}${suffix}`), "--no-install", entry, "--version"],
      { cwd: directory, env: { ...process.env, PATH: "", NODE_PATH: "" }, timeout: 10_000 }
    )
    expect(adapter.exitCode, adapter.stderr.toString()).toBe(0)
    const adapterPackage = JSON.parse(
      readFileSync(join(import.meta.dir, "../../../node_modules/@nyssance/codex-acp-v2/package.json"), "utf8")
    ) as { name: string; version: string }
    expect(adapter.stdout.toString().trim()).toBe(`${adapterPackage.name} ${adapterPackage.version}`)

    const binaries = join(directory, "bin")
    const resources = join(directory, "staged resources")
    mkdirSync(binaries)
    mkdirSync(join(resources, "adapter"), { recursive: true })
    copyFileSync(entry, join(resources, "adapter/codex-acp-v2.mjs"))
    copyFileSync(
      join(import.meta.dir, "../../../src-tauri/resources/adapter/codex-bootstrap.mjs"),
      join(resources, "adapter/codex-bootstrap.mjs")
    )
    for (const name of ["bun", "codex", "codex-code-mode-host", "alwith-runtime", "alwith-codex-launcher"]) {
      copyFileSync(
        join(import.meta.dir, `../../../src-tauri/binaries/${name}-${triple}${suffix}`),
        join(binaries, `${name}${suffix}`)
      )
    }
    const verification = Bun.spawnSync([process.execPath, "scripts/verify-bundled-toolchain.ts", binaries, resources], {
      cwd: join(import.meta.dir, "../../.."),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 90_000
    })
    expect(verification.exitCode, verification.stderr.toString()).toBe(0)
    expect(verification.stdout.toString()).toContain("ACP initialized")

    const packagedResources = process.platform === "darwin" ? join(directory, "Resources") : binaries
    mkdirSync(join(packagedResources, "adapter"), { recursive: true })
    copyFileSync(entry, join(packagedResources, "adapter/codex-acp-v2.mjs"))
    copyFileSync(join(resources, "adapter/codex-bootstrap.mjs"), join(packagedResources, "adapter/codex-bootstrap.mjs"))
    const packaged = Bun.spawnSync([process.execPath, "scripts/verify-bundled-toolchain.ts", binaries], {
      cwd: join(import.meta.dir, "../../.."),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 90_000
    })
    expect(packaged.exitCode, packaged.stderr.toString()).toBe(0)
    expect(packaged.stdout.toString()).toContain("ACP initialized")

    // An explicit missing resource must fail even when the default packaged resource exists.
    const missing = Bun.spawnSync(
      [process.execPath, "scripts/verify-bundled-toolchain.ts", binaries, join(directory, "missing resources")],
      { cwd: join(import.meta.dir, "../../.."), stdout: "pipe", stderr: "pipe", timeout: 15_000 }
    )
    expect(missing.exitCode).not.toBe(0)
    expect(missing.stderr.toString()).toContain("ENOENT")
    expect(missing.stderr.toString()).toContain("missing resources")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  // Staging includes native version probes and macOS signature checks.
}, 240_000)
