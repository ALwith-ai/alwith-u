import { createHash } from "node:crypto"
import { copyFileSync, cpSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** Stage the shared chat's embedded native gateway beside the existing independent modules. */
export function stageChatNative(root: string, target: string, destination: string, licenses: string): string {
  const platform =
    target === "aarch64-apple-darwin" ? "darwin-arm64" : target === "x86_64-pc-windows-msvc" ? "win32-x64" : null
  if (platform === null) throw new Error(`Unsupported chat native target: ${target}`)
  const packageRoot = join(root, "node_modules/@alwith/module-chat")
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
  const directory = join(packageRoot, "native", platform)
  const artifact = JSON.parse(readFileSync(join(directory, "artifact.json"), "utf8"))
  const binary = platform === "darwin-arm64" ? "libalwith_native_chat.dylib" : "alwith_native_chat.dll"
  if (
    manifest.name !== "@alwith/module-chat" ||
    artifact.module !== "chat" ||
    artifact.contract !== 2 ||
    artifact.abi !== 1 ||
    artifact.target !== target ||
    artifact.binary !== binary
  )
    throw new Error("Chat native artifact identity mismatch")
  const source = join(directory, binary)
  if (createHash("sha256").update(readFileSync(source)).digest("hex") !== artifact.sha256)
    throw new Error("Chat native binary checksum mismatch")
  mkdirSync(destination, { recursive: true })
  const output = join(destination, binary)
  copyFileSync(source, output)
  const legal = join(licenses, "alwith-native-chat")
  mkdirSync(legal, { recursive: true })
  copyFileSync(join(packageRoot, "LICENSE"), join(legal, "LICENSE"))
  for (const entry of ["THIRD_PARTY_NOTICES.md", "licenses"])
    cpSync(join(directory, entry), join(legal, entry), { recursive: true })
  return output
}
