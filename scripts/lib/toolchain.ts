/** Official npm artifacts; x64 baseline avoids requiring AVX2 on users' machines. */
export const BUN_PACKAGES: Record<string, string> = {
  "aarch64-apple-darwin": "@oven/bun-darwin-aarch64",
  "x86_64-unknown-linux-gnu": "@oven/bun-linux-x64-baseline",
  "aarch64-unknown-linux-gnu": "@oven/bun-linux-aarch64",
  "x86_64-pc-windows-msvc": "@oven/bun-windows-x64-baseline",
  "aarch64-pc-windows-msvc": "@oven/bun-windows-aarch64"
}

const CODEX_PLATFORMS = ["darwin-arm64", "linux-x64", "linux-arm64", "win32-x64", "win32-arm64"]

type Manifest = {
  packageManager: string
  devDependencies: Record<string, string>
  optionalDependencies: Record<string, string>
}

export function toolchainVersions(manifest: Manifest): { bun: string; codex: string } {
  const match = /^bun@(\d+\.\d+\.\d+)$/.exec(manifest.packageManager)
  if (!match) throw new Error("packageManager must pin an exact Bun version (bun@X.Y.Z)")
  const bun = match[1]!
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
  return { bun, codex }
}

export function assertVersion(name: string, actual: string | undefined, expected: string): void {
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, got ${actual ?? "missing"}`)
}
