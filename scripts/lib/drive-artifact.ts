import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** Stage the library shipped with the frontend, checking its protocol and exact bytes. */
export function stageDriveNative(root: string, target: string, destination: string, licenses: string): string {
  return stageModuleNative("drive", 2, root, target, destination, licenses)
}

export function stageModuleNative(
  module: "drive" | "editor" | "fs" | "auth",
  contract: number,
  root: string,
  target: string,
  destination: string,
  licenses: string
): string {
  const platform =
    target === "aarch64-apple-darwin" ? "darwin-arm64" : target === "x86_64-pc-windows-msvc" ? "win32-x64" : null
  if (!platform) throw new Error(`Unsupported ${module} target: ${target}`)
  const packageRoot = join(root, `node_modules/@alwith/module-${module}`)
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Record<string, unknown>
  if (manifest.name !== `@alwith/module-${module}`) throw new Error(`${module} package identity mismatch`)
  const source = join(packageRoot, "native", platform)
  const artifact = JSON.parse(readFileSync(join(source, "artifact.json"), "utf8")) as Record<string, unknown>
  const binary = platform === "darwin-arm64" ? `libalwith_native_${module}.dylib` : `alwith_native_${module}.dll`
  if (
    artifact.module !== module ||
    artifact.contract !== contract ||
    artifact.abi !== 1 ||
    artifact.target !== target ||
    artifact.binary !== binary
  )
    throw new Error(`${module} native artifact identity mismatch`)
  const bytes = readFileSync(join(source, binary))
  if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256)
    throw new Error(`${module} native binary checksum mismatch`)
  mkdirSync(destination, { recursive: true })
  const output = join(destination, binary)
  copyFileSync(join(source, binary), output)
  const legal = join(licenses, `alwith-native-${module}`)
  mkdirSync(legal, { recursive: true })
  copyFileSync(join(packageRoot, "LICENSE"), join(legal, "LICENSE"))
  copyFileSync(join(source, "THIRD_PARTY_NOTICES.md"), join(legal, "THIRD_PARTY_NOTICES.md"))
  return output
}
