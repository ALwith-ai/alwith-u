import { expect, test } from "bun:test"
import { join } from "node:path"
import { copyFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

const HOST_TRIPLES: Partial<Record<`${NodeJS.Platform}-${string}`, string>> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc"
}

test("the staged JS adapter runs with bundled Bun outside node_modules", () => {
  const triple = HOST_TRIPLES[`${process.platform}-${process.arch}`]
  if (triple === undefined) return

  const stage = Bun.spawnSync([process.execPath, "scripts/stage.ts", triple], {
    cwd: join(import.meta.dir, "../../.."),
    stdout: "ignore",
    stderr: "pipe",
    timeout: 45_000
  })
  expect(stage.exitCode, stage.stderr.toString()).toBe(0)

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
    expect(adapter.stdout.toString()).toMatch(/^@nyssance\/codex-acp-v2 \d+\.\d+\.\d+\s*$/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  // Staging includes native version probes and macOS signature checks.
}, 60_000)
