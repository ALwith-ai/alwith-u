/** Official npm artifacts; x64 baseline avoids requiring AVX2 on users' machines. */
export const BUN_PACKAGES: Record<string, string> = {
  "aarch64-apple-darwin": "@oven/bun-darwin-aarch64",
  "x86_64-unknown-linux-gnu": "@oven/bun-linux-x64-baseline",
  "x86_64-pc-windows-msvc": "@oven/bun-windows-x64-baseline"
}

const CODEX_PLATFORMS = ["darwin-arm64", "linux-x64", "win32-x64"]

type Manifest = {
  packageManager: string
  devDependencies: Record<string, string>
  optionalDependencies: Record<string, string>
}

/**
 * Two Bun versions on purpose: `packageManager` pins the Bun that builds the app (the developer's and
 * CI's), while the `@oven/bun-*` platform packages pin the Bun bundled with the app and shipped to users.
 * Upgrading the bundled one never requires reinstalling Bun on a developer machine.
 */
export function toolchainVersions(manifest: Manifest): { buildBun: string; bun: string; codex: string } {
  const match = /^bun@(\d+\.\d+\.\d+)$/.exec(manifest.packageManager)
  if (!match) throw new Error("packageManager must pin an exact Bun version (bun@X.Y.Z)")
  const buildBun = match[1]
  const bun = manifest.optionalDependencies[BUN_PACKAGES["aarch64-apple-darwin"]]
  if (!bun || !/^\d+\.\d+\.\d+$/.test(bun))
    throw new Error("the bundled Bun platform packages must pin an exact version")
  const codex = manifest.devDependencies["@openai/codex"]
  if (!codex || !/^\d+\.\d+\.\d+$/.test(codex)) throw new Error("@openai/codex must pin an exact version")
  for (const name of Object.values(BUN_PACKAGES)) {
    assertVersion(name, manifest.optionalDependencies[name], bun)
  }
  for (const platform of CODEX_PLATFORMS) {
    assertVersion(
      `@openai/codex-${platform}`,
      manifest.optionalDependencies[`@openai/codex-${platform}`],
      `npm:@openai/codex@${codex}-${platform}`
    )
  }
  return { buildBun, bun, codex }
}

export function assertVersion(name: string, actual: string | undefined, expected: string): void {
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, got ${actual ?? "missing"}`)
}

/** Windows sandbox executables shipped in the pinned Codex platform package. */
export const CODEX_WINDOWS_HELPERS = ["codex-windows-sandbox-setup", "codex-command-runner"] as const

export function codexSidecars(windows: boolean): string[] {
  return ["codex", "codex-code-mode-host", ...(windows ? CODEX_WINDOWS_HELPERS : [])]
}
