#!/usr/bin/env bun
/**
 * Stages the sidecars Tauri bundles (`bundle.externalBin`):
 *   binaries/codex-<triple>, codex-code-mode-host-<triple>  the native Codex CLI from the pinned @openai/codex platform package
 *   binaries/codex-acp-v2-<triple>                          the ACP v2 adapter compiled into a standalone Bun executable
 *   binaries/alwith-runtime-<triple>                        the closed ALwith Runtime binary (pinned release; explicit local override)
 * plus the licence notices shipped under resources/licenses.
 *
 * Usage: bun scripts/stage.ts [rust-target-triple]   (then TAURI_ENV_TARGET_TRIPLE, then the host)
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { $ } from "bun"
import { runtimeBuildArtifact, runtimeReleaseCache, runtimeSource, stageTarget } from "./lib/runtime-artifact"

const root = resolve(import.meta.dirname, "..")
const binaries = join(root, "src-tauri/binaries")
const licenses = join(root, "src-tauri/resources/licenses")

type Target = { npm: string; bun: string; exe: string }
const TARGETS: Record<string, Target> = {
  "aarch64-apple-darwin": {
    npm: "darwin-arm64",
    bun: "bun-darwin-arm64",
    exe: ""
  },
  "x86_64-apple-darwin": { npm: "darwin-x64", bun: "bun-darwin-x64", exe: "" },
  "x86_64-unknown-linux-gnu": {
    npm: "linux-x64",
    bun: "bun-linux-x64",
    exe: ""
  },
  "aarch64-unknown-linux-gnu": {
    npm: "linux-arm64",
    bun: "bun-linux-arm64",
    exe: ""
  },
  "x86_64-pc-windows-msvc": {
    npm: "win32-x64",
    bun: "bun-windows-x64",
    exe: ".exe"
  },
  "aarch64-pc-windows-msvc": {
    npm: "win32-arm64",
    bun: "bun-windows-arm64",
    exe: ".exe"
  }
}
// The npm package keeps the binary under its own vendor triple, which differs from Rust's on Linux.
const NPM_VENDOR_TRIPLE: Record<string, string> = {
  "x86_64-unknown-linux-gnu": "x86_64-unknown-linux-musl",
  "aarch64-unknown-linux-gnu": "aarch64-unknown-linux-musl"
}

async function hostTriple(): Promise<string> {
  const output = await $`rustc -vV`.text()
  const match = output.match(/^host: (.+)$/m)
  if (!match) throw new Error(`rustc -vV did not report a host triple:\n${output}`)
  return match[1]!.trim()
}

const nativeTriple = await hostTriple()
const triple = stageTarget(process.argv[2], process.env.TAURI_ENV_TARGET_TRIPLE, nativeTriple)
const target = TARGETS[triple]
if (!target) throw new Error(`Unsupported target triple ${triple}. Known: ${Object.keys(TARGETS).join(", ")}`)
mkdirSync(binaries, { recursive: true })
mkdirSync(licenses, { recursive: true })

const codexPackage = JSON.parse(readFileSync(join(root, "node_modules/@openai/codex/package.json"), "utf8"))
const codexVersion: string = codexPackage.version
const platformPackage = join(root, `node_modules/@openai/codex-${target.npm}`)
if (!existsSync(platformPackage)) {
  throw new Error(
    `Missing ${platformPackage}. Install the platform package for ${triple}: bun add -d @openai/codex-${target.npm}@npm:@openai/codex@${codexVersion}-${target.npm}`
  )
}
const vendorTriple = NPM_VENDOR_TRIPLE[triple] ?? triple
// Codex spawns `codex-code-mode-host` from its own directory; Tauri drops every sidecar
// next to the app executable, so both land side by side.
for (const name of ["codex", "codex-code-mode-host"]) {
  const source = join(platformPackage, "vendor", vendorTriple, "bin", `${name}${target.exe}`)
  if (!existsSync(source)) throw new Error(`Codex binary not found at ${source}`)
  const destination = join(binaries, `${name}-${triple}${target.exe}`)
  copyFileSync(source, destination)
  if (!target.exe) chmodSync(destination, 0o755)
  console.log(`${name} ${codexVersion} -> ${destination}`)
}

const adapterPackage = JSON.parse(readFileSync(join(root, "node_modules/@nyssance/codex-acp-v2/package.json"), "utf8"))
const adapterEntry = join(root, "node_modules/@nyssance/codex-acp-v2/dist/index.js")
const adapterDestination = join(binaries, `codex-acp-v2-${triple}${target.exe}`)
await $`bun build ${adapterEntry} --compile --minify --target=${target.bun} --outfile ${adapterDestination}`
console.log(`codex-acp-v2 ${adapterPackage.version} -> ${adapterDestination}`)

// alwith-runtime is the closed ALwith Runtime, shipped as a binary. Where it comes from:
//   RUNTIME_PATH=<file>      an explicit binary for this triple
//   RUNTIME_SOURCE=sibling   ../alwith-runtime/target[/<cross-target>]/release
//                            (needs `cargo build --release [--target <cross-target>]` there)
//   RUNTIME_SOURCE=release   the GitHub Release pinned in runtime.json, verified against SHA256SUMS
// Default: always the pinned release. A sibling checkout is an explicit development opt-in.
const runtimeDestination = join(binaries, `alwith-runtime-${triple}${target.exe}`)
copyFileSync(await resolveRuntime(), runtimeDestination)
if (!target.exe) chmodSync(runtimeDestination, 0o755)
console.log(`alwith-runtime -> ${runtimeDestination}`)

async function resolveRuntime(): Promise<string> {
  if (process.env.RUNTIME_PATH) {
    if (!existsSync(process.env.RUNTIME_PATH)) throw new Error(`RUNTIME_PATH not found: ${process.env.RUNTIME_PATH}`)
    return process.env.RUNTIME_PATH
  }
  const sibling = resolve(root, "../alwith-runtime")
  const source = runtimeSource(process.env.RUNTIME_SOURCE)
  if (source === "sibling") {
    const built = runtimeBuildArtifact(sibling, triple, nativeTriple)
    if (!existsSync(built))
      throw new Error(`alwith-runtime not built at ${built}; run cargo build --release${triple === nativeTriple ? "" : ` --target ${triple}`} in ${sibling}`)
    return built
  }
  return downloadRuntime()
}

async function downloadRuntime(): Promise<string> {
  const pin = JSON.parse(readFileSync(join(root, "runtime.json"), "utf8")) as { repo: string; version: string }
  const base = process.env.RUNTIME_BASE_URL ?? `https://github.com/${pin.repo}/releases/download/v${pin.version}`
  const archiveName = `alwith-runtime-${triple}.tar.gz`
  const cache = runtimeReleaseCache(binaries, pin.version, triple)
  const binary = join(cache, `alwith-runtime${target.exe}`)
  if (existsSync(binary)) {
    console.log(`alwith-runtime ${pin.version} (cached)`)
    return binary
  }
  const [sums, archive] = await Promise.all([
    fetchAsset(pin, base, "SHA256SUMS").then(response => response.text()),
    fetchAsset(pin, base, archiveName).then(response => response.bytes())
  ])
  const expected = sums
    .split("\n")
    .map(line => line.trim().split(/\s+\*?/))
    .find(([, name]) => name === archiveName)?.[0]
  if (!expected) throw new Error(`SHA256SUMS at ${base} has no entry for ${archiveName}`)
  const actual = new Bun.CryptoHasher("sha256").update(archive).digest("hex")
  if (actual !== expected) throw new Error(`${archiveName}: sha256 ${actual} != ${expected} from SHA256SUMS`)
  rmSync(cache, { recursive: true, force: true })
  mkdirSync(cache, { recursive: true })
  const archivePath = join(cache, archiveName)
  writeFileSync(archivePath, archive)
  await $`tar -xzf ${archivePath} -C ${cache}`
  rmSync(archivePath)
  if (!existsSync(binary)) throw new Error(`${archiveName} did not contain alwith-runtime${target.exe}`)
  console.log(`alwith-runtime ${pin.version} <- ${base}/${archiveName}`)
  return binary
}

async function fetchOk(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response
}

/**
 * A release asset. Public repositories serve the plain download URL; a private one (the Runtime
 * source repository) needs a token, in which case the asset is fetched through the GitHub
 * API. The token comes from GH_TOKEN / GITHUB_TOKEN, else from `gh auth token` when the
 * GitHub CLI is logged in. RUNTIME_BASE_URL bypasses all of this (local tests).
 */
async function fetchAsset(pin: { repo: string; version: string }, base: string, name: string): Promise<Response> {
  if (process.env.RUNTIME_BASE_URL) return fetchOk(`${base}/${name}`)
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? (await ghAuthToken())
  if (token === null) return fetchOk(`${base}/${name}`)
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
  const release = (await fetchOk(`https://api.github.com/repos/${pin.repo}/releases/tags/v${pin.version}`, {
    headers
  }).then(response => response.json())) as { assets: Array<{ name: string; url: string }> }
  const asset = release.assets.find(entry => entry.name === name)
  if (!asset) throw new Error(`release v${pin.version} of ${pin.repo} has no asset ${name}`)
  return fetchOk(asset.url, { headers: { ...headers, Accept: "application/octet-stream" } })
}

async function ghAuthToken(): Promise<string | null> {
  const result = await $`gh auth token`.quiet().nothrow()
  const token = result.stdout.toString().trim()
  return result.exitCode === 0 && token.length > 0 ? token : null
}

// The @openai/codex npm package ships no licence file; resources/licenses/codex.txt is kept in the repo.
const adapterLicense = join(root, "node_modules/@nyssance/codex-acp-v2/LICENSE")
if (!existsSync(adapterLicense)) throw new Error(`Licence file missing: ${adapterLicense}`)
copyFileSync(adapterLicense, join(licenses, "codex-acp-v2.txt"))
console.log(`licences -> ${licenses}`)
