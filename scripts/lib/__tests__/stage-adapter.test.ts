import { expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import providers from "../../../src/lib/provider-catalog.json"
import { codexSidecars } from "../toolchain"

const HOST_TRIPLES: Partial<Record<`${NodeJS.Platform}-${string}`, string>> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc"
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

  expect(
    readFileSync(join(import.meta.dir, "../../../src-tauri/resources/licenses/codex-acp-v2-protocol.txt"))
  ).toEqual(
    readFileSync(join(import.meta.dir, "../../../node_modules/@nyssance/codex-acp-v2/licenses/alwith-protocol.txt"))
  )

  const suffix = process.platform === "win32" ? ".exe" : ""
  const features = Bun.spawnSync(
    [join(import.meta.dir, `../../../src-tauri/binaries/alwith-codex-launcher-${triple}${suffix}`), "features", "list"],
    {
      env: {
        ...process.env,
        ALWITH_U_CODEX_PATH: join(import.meta.dir, `../../../src-tauri/binaries/codex-${triple}${suffix}`)
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000
    }
  )
  expect(features.exitCode, features.stderr.toString()).toBe(0)
  expect(features.stdout.toString()).toMatch(/^default_mode_request_user_input\s+.*\s+true$/m)
  for (const provider of providers) {
    if (!provider.catalog) continue
    const path = join(import.meta.dir, "../../../src-tauri/resources", provider.catalog)
    const catalog = Bun.spawnSync(
      [
        join(import.meta.dir, `../../../src-tauri/binaries/codex-${triple}${suffix}`),
        "-c",
        `model_catalog_json=${JSON.stringify(path)}`,
        "debug",
        "models"
      ],
      { stdout: "pipe", stderr: "pipe", timeout: 10_000 }
    )
    expect(catalog.exitCode, catalog.stderr.toString()).toBe(0)
    const parsed = JSON.parse(catalog.stdout.toString()) as { models: Array<{ slug: string }> }
    for (const model of provider.models) {
      expect(
        parsed.models.map((entry) => entry.slug),
        `${provider.id}/${model.id}`
      ).toContain(model.id)
    }
  }
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
    mkdirSync(join(resources, "custom"), { recursive: true })
    copyFileSync(
      join(import.meta.dir, "../../../src-tauri/resources/custom/models.json"),
      join(resources, "custom/models.json")
    )
    for (const provider of providers) {
      const source = join(import.meta.dir, "../../../src-tauri/resources", provider.catalog)
      const target = join(resources, provider.catalog)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(source, target)
    }
    copyFileSync(entry, join(resources, "adapter/codex-acp-v2.mjs"))
    copyFileSync(
      join(import.meta.dir, "../../../src-tauri/resources/adapter/codex-bootstrap.mjs"),
      join(resources, "adapter/codex-bootstrap.mjs")
    )
    for (const name of [
      "bun",
      ...codexSidecars(process.platform === "win32"),
      "alwith-runtime",
      "alwith-codex-launcher"
    ]) {
      copyFileSync(
        join(import.meta.dir, `../../../src-tauri/binaries/${name}-${triple}${suffix}`),
        join(binaries, `${name}${suffix}`)
      )
    }
    if (process.platform === "win32") {
      for (const name of ["codex-windows-sandbox-setup", "codex-command-runner"]) {
        const helper = join(binaries, `${name}.exe`)
        renameSync(helper, `${helper}.hidden`)
        try {
          const missingHelper = Bun.spawnSync(
            [process.execPath, "scripts/verify-bundled-toolchain.ts", binaries, resources],
            { stdout: "pipe", stderr: "pipe", timeout: 15_000 }
          )
          expect(missingHelper.exitCode).not.toBe(0)
          expect(missingHelper.stderr.toString()).toContain(`Packaged sidecar missing: ${name}`)
        } finally {
          renameSync(`${helper}.hidden`, helper)
        }
      }
    }
    const verification = Bun.spawnSync([process.execPath, "scripts/verify-bundled-toolchain.ts", binaries, resources], {
      cwd: join(import.meta.dir, "../../.."),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 180_000
    })
    expect(verification.exitCode, verification.stderr.toString()).toBe(0)
    expect(verification.stdout.toString()).toContain("ACP initialized")

    const packagedResources = process.platform === "darwin" ? join(directory, "Resources") : binaries
    mkdirSync(join(packagedResources, "adapter"), { recursive: true })
    mkdirSync(join(packagedResources, "custom"), { recursive: true })
    copyFileSync(join(resources, "custom/models.json"), join(packagedResources, "custom/models.json"))
    for (const provider of providers) {
      const target = join(packagedResources, provider.catalog)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(join(resources, provider.catalog), target)
    }
    copyFileSync(entry, join(packagedResources, "adapter/codex-acp-v2.mjs"))
    copyFileSync(join(resources, "adapter/codex-bootstrap.mjs"), join(packagedResources, "adapter/codex-bootstrap.mjs"))
    const packaged = Bun.spawnSync([process.execPath, "scripts/verify-bundled-toolchain.ts", binaries], {
      cwd: join(import.meta.dir, "../../.."),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 180_000
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
}, 420_000)
