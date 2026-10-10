#!/usr/bin/env bun
/**
 * Stages the sidecars Tauri bundles (`bundle.externalBin`):
 *   binaries/bun-<triple>                                  the pinned official @oven/bun platform package
 *   binaries/codex-<triple>, codex-code-mode-host-<triple>  the native Codex CLI from the pinned @openai/codex platform package
 *   binaries/alwith-codex-launcher-<triple>              U-owned CODEX_PATH proxy
 *   resources/adapter/codex-bootstrap.mjs                U-owned local catalog startup
 *   resources/adapter/codex-acp-v2.mjs                     the adapter's self-contained JS bundle, run by bundled Bun
 *   binaries/alwith-runtime-<triple>                        the closed ALwith Runtime binary from the @alwith/runtime platform package (explicit local override)
 * plus the licence notices shipped under resources/licenses.
 *
 * Usage: bun scripts/stage.ts [rust-target-triple]   (then TAURI_ENV_TARGET_TRIPLE, then the host)
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { $ } from "bun"
import { stageNative } from "@alwith/native/stage"
import { stageRuntime } from "@alwith/runtime/stage"
import { runtimeBuildArtifact, runtimeSource, stageTarget } from "./lib/runtime-artifact"
import manifest from "../package.json"
import { assertVersion, BUN_PACKAGES, toolchainVersions } from "./lib/toolchain"

const root = resolve(import.meta.dirname, "..")
const binaries = join(root, "src-tauri/binaries")
const licenses = join(root, "src-tauri/resources/licenses")
const versions = toolchainVersions(manifest)
assertVersion("build Bun", Bun.version, versions.bun)

type Target = { npm: string; exe: string }
const TARGETS: Record<string, Target> = {
  "aarch64-apple-darwin": {
    npm: "darwin-arm64",
    exe: ""
  },
  "x86_64-unknown-linux-gnu": {
    npm: "linux-x64",
    exe: ""
  },
  "aarch64-unknown-linux-gnu": {
    npm: "linux-arm64",
    exe: ""
  },
  "x86_64-pc-windows-msvc": {
    npm: "win32-x64",
    exe: ".exe"
  },
  "aarch64-pc-windows-msvc": {
    npm: "win32-arm64",
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
if (!existsSync(join(licenses, `bun-${versions.bun}.md`))) {
  throw new Error(`Missing Bun ${versions.bun} licence notice; update resources/licenses with the version bump`)
}
const bunPackageName = BUN_PACKAGES[triple]
if (!bunPackageName) throw new Error(`No Bun artifact configured for ${triple}`)
const bunPackageDir = join(root, "node_modules", bunPackageName)
if (!existsSync(bunPackageDir)) throw new Error(`Missing ${bunPackageName}; run bun install for ${triple}`)
const bunPackage = JSON.parse(readFileSync(join(bunPackageDir, "package.json"), "utf8"))
assertVersion("installed Bun package", bunPackage.version, versions.bun)
const bunDestination = join(binaries, `bun-${triple}${target.exe}`)
copyFileSync(join(bunPackageDir, "bin", `bun${target.exe}`), bunDestination)
if (!target.exe) chmodSync(bunDestination, 0o755)
if (triple.endsWith("apple-darwin")) {
  const identity = process.env.APPLE_SIGNING_IDENTITY
  if (identity) {
    await $`codesign --force --timestamp --options runtime --entitlements ${join(root, "src-tauri/Entitlements.plist")} --sign ${identity} ${bunDestination}`
  } else {
    // The official npm binary can carry an invalid linker signature, just like compiled Bun apps.
    await $`codesign --force --entitlements ${join(root, "src-tauri/Entitlements.plist")} --sign - ${bunDestination}`
  }
  await $`codesign --verify --strict ${bunDestination}`
}
if (triple === nativeTriple) {
  assertVersion("staged Bun", (await $`${bunDestination} --version`.text()).trim(), versions.bun)
}
console.log(`bun ${versions.bun} -> ${bunDestination}`)
const nativeLibrary = stageNative(triple, join(root, "src-tauri/resources/native"), licenses)
if (triple.endsWith("apple-darwin") && process.env.APPLE_SIGNING_IDENTITY) {
  // A hardened application must load a library signed by the same team. Verify
  // the distributed bytes first, then sign the staged copy using the app's identity.
  await $`codesign --force --timestamp --options runtime --sign ${process.env.APPLE_SIGNING_IDENTITY} ${nativeLibrary}`
}
console.log(`alwith-native -> ${nativeLibrary}`)

const codexPackage = JSON.parse(readFileSync(join(root, "node_modules/@openai/codex/package.json"), "utf8"))
const codexVersion: string = codexPackage.version
assertVersion("installed Codex package", codexVersion, versions.codex)
const platformPackage = join(root, `node_modules/@openai/codex-${target.npm}`)
if (!existsSync(platformPackage)) {
  throw new Error(
    `Missing ${platformPackage}. Install the platform package for ${triple}: bun add -d @openai/codex-${target.npm}@npm:@openai/codex@${codexVersion}-${target.npm}`
  )
}
const codexPlatformPackage = JSON.parse(readFileSync(join(platformPackage, "package.json"), "utf8"))
assertVersion("installed Codex platform package", codexPlatformPackage.version, `${codexVersion}-${target.npm}`)
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
if (triple === nativeTriple) {
  const codexDestination = join(binaries, `codex-${triple}${target.exe}`)
  assertVersion("staged Codex", (await $`${codexDestination} --version`.text()).trim(), `codex-cli ${codexVersion}`)
}

const adapterPackage = JSON.parse(readFileSync(join(root, "node_modules/@nyssance/codex-acp-v2/package.json"), "utf8"))
const adapterEntry = join(root, "node_modules/@nyssance/codex-acp-v2/dist/index.js")
const adapterDirectory = join(root, "src-tauri/resources/adapter")
mkdirSync(adapterDirectory, { recursive: true })
const adapterDestination = join(adapterDirectory, "codex-acp-v2.mjs")
// Preserve the published adapter byte-for-byte. U's cache bootstrap is a separate resource.
copyFileSync(adapterEntry, adapterDestination)
const bootstrapBuild = await Bun.build({
  entrypoints: [join(root, "scripts/codex-bootstrap.ts")],
  target: "bun",
  format: "esm"
})
if (!bootstrapBuild.success) throw new AggregateError(bootstrapBuild.logs, "Codex bootstrap bundling failed")
await Bun.write(join(adapterDirectory, "codex-bootstrap.mjs"), bootstrapBuild.outputs[0]!)

// A small std-only proxy avoids bundling another copy of the Bun runtime.
const launcherDestination = join(binaries, `alwith-codex-launcher-${triple}${target.exe}`)
await $`rustc --edition=2024 --crate-name alwith_codex_launcher --target ${triple} -C opt-level=s -C strip=symbols ${join(root, "src-tauri/src/codex_launcher.rs")} -o ${launcherDestination}`
if (triple.endsWith("apple-darwin")) {
  const identity = process.env.APPLE_SIGNING_IDENTITY
  if (identity) await $`codesign --force --timestamp --options runtime --sign ${identity} ${launcherDestination}`
  else await $`codesign --force --sign - ${launcherDestination}`
  await $`codesign --verify --strict ${launcherDestination}`
}
console.log(`alwith-codex-launcher -> ${launcherDestination}`)
if (triple === nativeTriple) {
  assertVersion(
    "staged ACP adapter",
    (await $`${bunDestination} --no-install ${adapterDestination} --version`.text()).trim(),
    `@nyssance/codex-acp-v2 ${adapterPackage.version}`
  )
}
console.log(`codex-acp-v2 ${adapterPackage.version} -> ${adapterDestination}`)

// alwith-runtime is the closed ALwith Runtime, shipped as npm platform packages (@alwith/runtime).
//   RUNTIME_PATH=<file>      an explicit binary for this triple
//   RUNTIME_SOURCE=sibling   ../alwith-runtime/target[/<cross-target>]/release
//                            (needs `cargo build --release [--target <cross-target>]` there)
//   RUNTIME_SOURCE=npm       the installed @alwith/runtime-<platform> package, sha256 verified (default)
const runtimeDestination = join(binaries, `alwith-runtime-${triple}${target.exe}`)
const runtimeOverride = resolveRuntimeOverride()
if (runtimeOverride) {
  copyFileSync(runtimeOverride, runtimeDestination)
  if (!target.exe) chmodSync(runtimeDestination, 0o755)
} else {
  stageRuntime(triple, runtimeDestination, licenses)
}
console.log(`alwith-runtime -> ${runtimeDestination}`)

/** A development override for the Runtime binary; null means the installed npm package. */
function resolveRuntimeOverride(): string | null {
  if (process.env.RUNTIME_PATH) {
    if (!existsSync(process.env.RUNTIME_PATH)) throw new Error(`RUNTIME_PATH not found: ${process.env.RUNTIME_PATH}`)
    return process.env.RUNTIME_PATH
  }
  if (runtimeSource(process.env.RUNTIME_SOURCE) === "npm") return null
  const sibling = resolve(root, "../alwith-runtime")
  const built = runtimeBuildArtifact(sibling, triple, nativeTriple)
  if (!existsSync(built))
    throw new Error(
      `alwith-runtime not built at ${built}; run cargo build --release${triple === nativeTriple ? "" : ` --target ${triple}`} in ${sibling}`
    )
  return built
}

// The @openai/codex npm package ships no licence file; resources/licenses/codex.txt is kept in the repo.
const adapterLicense = join(root, "node_modules/@nyssance/codex-acp-v2/LICENSE")
if (!existsSync(adapterLicense)) throw new Error(`Licence file missing: ${adapterLicense}`)
copyFileSync(adapterLicense, join(licenses, "codex-acp-v2.txt"))
const driveLicenses = join(licenses, "alwith-drive")
mkdirSync(driveLicenses, { recursive: true })
for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  copyFileSync(join(root, "node_modules/@alwith/module-drive", name), join(driveLicenses, name))
}
console.log(`licences -> ${licenses}`)
