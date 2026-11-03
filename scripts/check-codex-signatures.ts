#!/usr/bin/env bun
// Codex and its helpers must reach the app with their vendor bytes and signature: staging copies
// them, never re-signs them. Run after `bun run stage`, or with a built .app (macOS) or the
// directory holding the bundled executables (Windows) to check the packaged copies.
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { $ } from "bun"

import { CODEX_WINDOWS_HELPERS, codexSidecars } from "./lib/toolchain"

const root = resolve(import.meta.dirname, "..")
const triple = (await $`rustc -vV`.text()).match(/^host: (.+)$/m)?.[1]?.trim()
const targets: Record<string, { platform: string; exe: string }> = {
  "aarch64-apple-darwin": { platform: "darwin-arm64", exe: "" },
  "x86_64-pc-windows-msvc": { platform: "win32-x64", exe: ".exe" }
}
const target = triple === undefined ? undefined : targets[triple]
if (triple === undefined || target === undefined)
  throw new Error(`Unsupported signature verification target: ${triple}`)
const bundle = process.argv[2]
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")
const team = async (path: string) =>
  (
    (await $`codesign -dv ${path}`.quiet().nothrow()).stderr.toString().match(/^TeamIdentifier=(.+)$/m)?.[1] ?? ""
  ).trim()

for (const name of codexSidecars(target.exe === ".exe")) {
  const directory = CODEX_WINDOWS_HELPERS.some((helper) => helper === name) ? "codex-resources" : "bin"
  const original = join(
    root,
    `node_modules/@openai/codex-${target.platform}/vendor`,
    triple,
    directory,
    `${name}${target.exe}`
  )
  const copies = bundle
    ? [join(resolve(bundle), target.exe ? "" : "Contents/MacOS", `${name}${target.exe}`)]
    : [
        join(root, "src-tauri/binaries", `${name}-${triple}${target.exe}`),
        // Staging also places the code-mode host beside the suffixed CLI for live checks.
        ...(name === "codex-code-mode-host" ? [join(root, "src-tauri/binaries", `${name}${target.exe}`)] : [])
      ].filter((path, index) => index === 0 || existsSync(path))
  for (const staged of copies) {
    if (hash(original) !== hash(staged)) throw new Error(`${staged}: vendor bytes changed during staging or bundling`)
    if (target.exe) continue
    await $`codesign --verify --strict ${staged}`.quiet()
    const expected = await team(original)
    const actual = await team(staged)
    if (expected === "" || actual !== expected)
      throw new Error(`${staged}: TeamIdentifier ${actual || "missing"}, expected the vendor's ${expected || "(none)"}`)
  }
}
console.log("PASS: Codex and code-mode host keep their vendor bytes, signatures and TeamIdentifier")
