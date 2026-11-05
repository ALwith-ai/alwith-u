import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { stageChatNative } from "../chat-artifact"

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "alwith-chat-artifact-"))
  const packageRoot = join(root, "node_modules/@alwith/module-chat")
  const native = join(packageRoot, "native/darwin-arm64")
  mkdirSync(join(native, "licenses"), { recursive: true })
  const bytes = "native fixture"
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "@alwith/module-chat" }))
  writeFileSync(join(packageRoot, "LICENSE"), "module license")
  writeFileSync(join(native, "THIRD_PARTY_NOTICES.md"), "notices")
  writeFileSync(join(native, "licenses/dependency.txt"), "dependency license")
  writeFileSync(join(native, "libalwith_native_chat.dylib"), bytes)
  writeFileSync(
    join(native, "artifact.json"),
    JSON.stringify({
      module: "chat",
      contract: 2,
      abi: 1,
      target: "aarch64-apple-darwin",
      binary: "libalwith_native_chat.dylib",
      sha256: createHash("sha256").update(bytes).digest("hex")
    })
  )
  return { root, native, output: join(root, "output"), legal: join(root, "legal") }
}

test("chat staging verifies the artifact and includes its redistribution notices", () => {
  const f = fixture()
  try {
    const path = stageChatNative(f.root, "aarch64-apple-darwin", f.output, f.legal)
    expect(readFileSync(path, "utf8")).toBe("native fixture")
    expect(readFileSync(join(f.legal, "alwith-native-chat/licenses/dependency.txt"), "utf8")).toBe("dependency license")
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test("a tampered chat artifact is rejected before anything is staged", () => {
  const f = fixture()
  try {
    writeFileSync(join(f.native, "libalwith_native_chat.dylib"), "tampered")
    expect(() => stageChatNative(f.root, "aarch64-apple-darwin", f.output, f.legal)).toThrow("checksum mismatch")
    expect(existsSync(f.output)).toBe(false)
    expect(() => stageChatNative(f.root, "aarch64-unknown-linux-gnu", f.output, f.legal)).toThrow("Unsupported")
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})
