/** Official npm artifacts; x64 baseline avoids requiring AVX2 on users' machines. */
export const BUN_PACKAGES: Record<string, string> = {
  "aarch64-apple-darwin": "@oven/bun-darwin-aarch64",
  "x86_64-pc-windows-msvc": "@oven/bun-windows-x64-baseline"
}

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
export function toolchainVersions(manifest: Manifest): { buildBun: string; bun: string } {
  const match = /^bun@(\d+\.\d+\.\d+)$/.exec(manifest.packageManager)
  if (!match) throw new Error("packageManager must pin an exact Bun version (bun@X.Y.Z)")
  const buildBun = match[1]
  const bun = manifest.optionalDependencies[BUN_PACKAGES["aarch64-apple-darwin"]]
  if (!bun || !/^\d+\.\d+\.\d+$/.test(bun))
    throw new Error("the bundled Bun platform packages must pin an exact version")
  // The chat engine brings the Codex build its adapter was generated against.
  for (const dependencies of [manifest.devDependencies, manifest.optionalDependencies])
    if (Object.keys(dependencies).some((name) => name.startsWith("@openai/codex")))
      throw new Error("Codex comes with @alwith/module-chat; the application must not declare it")
  for (const name of Object.values(BUN_PACKAGES)) {
    assertVersion(name, manifest.optionalDependencies[name], bun)
  }
  return { buildBun, bun }
}

export function assertVersion(name: string, actual: string | undefined, expected: string): void {
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, got ${actual ?? "missing"}`)
}
