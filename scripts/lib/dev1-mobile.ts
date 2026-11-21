// Dev1 consumes an unpublished mobile candidate. Keep both halves in one private build directory.
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync
} from "node:fs"
import { join, resolve } from "node:path"

const base = "f6cf238085df47f54fafd9fa8ae69114d80291f4"
const deltaSHA = "dcc105c60a22520dfe0293d68fa2a6cfce927a7c66de68c98abfc7ce20c98723"
const runtimeSdkSHA = "1bed1633d49eed6f0ac5ce163275c5e9b66141f5ac0354e7ac5d16d2e15d857b"
const paths = ["crates/mobile", "crates/native-mobile", "packages/mobile/rust"]
const digest = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex")

function sdkDigest(root: string): string {
  const hash = createHash("sha256")
  function visit(dir: string): void {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1
    )) {
      const name = dir ? dir + "/" + entry.name : entry.name
      if (entry.isDirectory()) visit(name)
      else if (entry.isFile()) hash.update(name + "\0" + digest(readFileSync(join(root, name))) + "\n")
      else throw new Error(`Unexpected Runtime SDK entry: ${name}`)
    }
  }
  visit("")
  return hash.digest("hex")
}

// Use the same Git patch for new source files before and after they enter the module repository's index.
function mobileSourceDelta(source: string): Buffer {
  const cwd = { cwd: source }
  const names = (args: string[]): string[] =>
    execFileSync("git", args, { ...cwd, encoding: "utf8" })
      .split("\0")
      .filter(Boolean)
  const tracked = names(["diff", "--no-renames", "--name-only", "-z", base, "--", ...paths])
  const untracked = new Set(names(["ls-files", "--others", "--exclude-standard", "-z", "--", ...paths]))
  const options = [
    "--binary",
    "--full-index",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--diff-algorithm=myers",
    "--no-indent-heuristic",
    "-U3",
    "--src-prefix=a/",
    "--dst-prefix=b/"
  ]
  const patches = [...new Set([...tracked, ...untracked])].sort().map((path) => {
    if (!untracked.has(path)) return execFileSync("git", ["diff", ...options, base, "--", path], cwd)
    const diff = spawnSync("git", ["diff", "--no-index", ...options, "--", "/dev/null", path], cwd)
    if (diff.error) throw diff.error
    if (diff.status !== 1) throw new Error(`Unable to diff new mobile source ${path}: ${diff.stderr.toString()}`)
    return diff.stdout
  })
  return Buffer.concat(patches)
}

export function prepareDev1Mobile(root: string): { sdk: string; from: string; lock: string } {
  const target =
    process.platform === "darwin" && process.arch === "arm64"
      ? "aarch64-apple-darwin"
      : process.platform === "win32" && process.arch === "x64"
        ? "x86_64-pc-windows-msvc"
        : undefined
  if (!target) throw new Error("Unsupported Dev1 mobile target")
  const cache = join(root, "src-tauri/target-dev1/mobile-candidates")
  const appLock = join(root, "src-tauri/Cargo.lock")
  const key = digest(base + deltaSHA + runtimeSdkSHA + target + digest(readFileSync(appLock)))
  const candidate = join(cache, key)
  const result = {
    sdk: join(candidate, "sdk"),
    from: join(candidate, "stage.cjs"),
    lock: join(candidate, "Cargo.lock")
  }
  if (existsSync(candidate)) return result

  const source = resolve(process.env.ALWITH_MODULES_SOURCE ?? join(root, "../alwith-modules"))
  const delta = mobileSourceDelta(source)
  if (digest(delta) !== deltaSHA) throw new Error("Dev1 requires the pinned alwith-modules mobile sources")
  mkdirSync(cache, { recursive: true })
  const scratch = mkdtempSync(join(cache, ".prepare-"))
  const repo = join(scratch, "modules")
  const output = join(scratch, "candidate")
  const env = { ...process.env }
  delete env.CARGO_TARGET_DIR
  const run = (cmd: string, args: string[], cwd: string): void => {
    execFileSync(cmd, args, { cwd, env, stdio: "inherit" })
  }
  try {
    run("git", ["clone", "--quiet", "--no-checkout", "--no-hardlinks", source, repo], scratch)
    run("git", ["checkout", "--quiet", "--detach", base], repo)
    if (delta.length) execFileSync("git", ["apply", "-"], { cwd: repo, input: delta })
    // The mobile builder consumes only the installed Runtime Rust SDK from the JS workspace.
    const runtime = "node_modules/@alwith/api/rust"
    const sdk = join(repo, runtime)
    if (existsSync(join(source, runtime))) cpSync(join(source, runtime), sdk, { recursive: true })
    else run("bun", ["install", "--frozen-lockfile"], repo)
    if (sdkDigest(sdk) !== runtimeSdkSHA) throw new Error("Dev1 Runtime SDK differs from the pinned mobile build input")

    run("bun", ["scripts/build-native.ts", "mobile", target, "--skip-tests"], repo)
    const pkg = join(output, "node_modules/@alwith/module-mobile")
    mkdirSync(pkg, { recursive: true })
    for (const file of ["package.json", "LICENSE"]) cpSync(join(repo, "packages/mobile", file), join(pkg, file))
    const platform = process.platform + "-" + process.arch
    cpSync(join(repo, "target/native-dist/mobile", platform), join(pkg, "native", platform), { recursive: true })

    const dist = join(scratch, "pack")
    run(
      "cargo",
      [
        "package",
        "--no-verify",
        "--allow-dirty",
        "--manifest-path",
        "packages/mobile/rust/Cargo.toml",
        "--target-dir",
        dist
      ],
      repo
    )
    const archives = readdirSync(join(dist, "package")).filter((file) => file.endsWith(".crate"))
    if (archives.length !== 1) throw new Error("Expected exactly one mobile SDK crate")
    cpSync(appLock, join(output, "Cargo.lock"))
    mkdirSync(join(output, "sdk"))
    run(
      "tar",
      ["-xf", join(dist, "package", archives[0]!), "--strip-components", "1", "-C", join(output, "sdk")],
      scratch
    )
    try {
      renameSync(output, candidate)
    } catch (error) {
      if (!existsSync(candidate)) throw error
    }
    return result
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

// Resolve the SDK before Tauri starts its build hooks. Older Dev1 installations
// can have a machine-local Cargo paths override which takes precedence over a patch.
export function dev1CargoArgs(root: string, candidate: ReturnType<typeof prepareDev1Mobile>): string[] {
  const args = [
    "--config",
    `resolver.lockfile-path=${JSON.stringify(candidate.lock)}`,
    "--config",
    `patch.crates-io.alwith-mobile.path=${JSON.stringify(candidate.sdk)}`
  ]
  const platform = process.platform === "darwin" ? "aarch64-apple-darwin" : "x86_64-pc-windows-msvc"
  const resolved: { packages: Array<{ name: string; manifest_path: string }> } = JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--filter-platform", platform, ...args], {
      cwd: join(root, "src-tauri"),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    })
  )
  const mobile = resolved.packages.find((pkg) => pkg.name === "alwith-mobile")
  if (!mobile || realpathSync(mobile.manifest_path) !== realpathSync(join(candidate.sdk, "Cargo.toml")))
    throw new Error("Dev1 mobile SDK is shadowed. Remove the old alwith-mobile entry from Cargo paths overrides.")
  return [...args, "--locked"]
}
