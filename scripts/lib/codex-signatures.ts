import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { CODEX_WINDOWS_HELPERS, codexPlatformDirectory, codexSidecars } from "./toolchain"

type SignatureResult = { status: number | null; stderr: string; error?: Error }
type SignatureRunner = (args: string[]) => SignatureResult

const runCodesign: SignatureRunner = (args) => spawnSync("/usr/bin/codesign", args, { encoding: "utf8" })
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")

function vendorTeam(path: string, run: SignatureRunner): string {
  const verification = run(["--verify", "--strict", path])
  if (verification.error) throw verification.error
  if (verification.status !== 0)
    throw new Error(`${path}: invalid Codex vendor signature: ${verification.stderr.trim()}`)
  const description = run(["-dv", path])
  if (description.error) throw description.error
  if (description.status !== 0)
    throw new Error(`${path}: cannot inspect Codex vendor signature: ${description.stderr.trim()}`)
  const team = description.stderr.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim()
  if (!team || team === "not set") throw new Error(`${path}: Codex vendor TeamIdentifier is missing`)
  return team
}

/** Check both staging and final bundles; a valid application re-signature still violates vendor identity. */
export function verifyCodexArtifacts(
  root: string,
  triple: string,
  executableDirectory?: string,
  run: SignatureRunner = runCodesign
): void {
  const targets: Record<string, { platform: string; exe: string }> = {
    "aarch64-apple-darwin": { platform: "darwin-arm64", exe: "" },
    "x86_64-pc-windows-msvc": { platform: "win32-x64", exe: ".exe" }
  }
  const target = targets[triple]
  if (!target) throw new Error(`Unsupported signature verification target: ${triple}`)
  for (const name of codexSidecars(target.exe === ".exe")) {
    const directory = CODEX_WINDOWS_HELPERS.some((helper) => helper === name) ? "codex-resources" : "bin"
    const original = join(
      codexPlatformDirectory(root, target.platform),
      "vendor",
      triple,
      directory,
      `${name}${target.exe}`
    )
    const copies = executableDirectory
      ? [join(executableDirectory, `${name}${target.exe}`)]
      : [
          join(root, "src-tauri/binaries", `${name}-${triple}${target.exe}`),
          ...(name === "codex-code-mode-host" && existsSync(join(root, "src-tauri/binaries", name))
            ? [join(root, "src-tauri/binaries", name)]
            : [])
        ]
    const expectedHash = hash(original)
    const expectedTeam = target.exe ? null : vendorTeam(original, run)
    for (const copy of copies) {
      if (hash(copy) !== expectedHash) throw new Error(`${copy}: Codex vendor bytes changed during staging or bundling`)
      if (!target.exe && vendorTeam(copy, run) !== expectedTeam)
        throw new Error(`${copy}: Codex vendor TeamIdentifier changed during staging or bundling`)
    }
  }
}
