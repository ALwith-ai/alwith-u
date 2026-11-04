import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { stageDriveNative, stageModuleNative } from "../drive-artifact"

const directories: string[] = []
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

function fixture(
  platform: string,
  target: string,
  binary: string,
  module = "drive",
  contract = 2
): { root: string; source: string } {
  const root = mkdtempSync(join(tmpdir(), "u-drive-artifact-"))
  directories.push(root)
  const packageRoot = join(root, `node_modules/@alwith/module-${module}`)
  const source = join(packageRoot, "native", platform)
  mkdirSync(source, { recursive: true })
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: `@alwith/module-${module}`, version: "0.6.1" })
  )
  writeFileSync(join(packageRoot, "LICENSE"), "license")
  writeFileSync(join(source, "THIRD_PARTY_NOTICES.md"), "notices")
  writeFileSync(join(source, binary), "verified library")
  writeFileSync(
    join(source, "artifact.json"),
    JSON.stringify({
      module,
      contract,
      abi: 1,
      target,
      binary,
      sha256: createHash("sha256").update("verified library").digest("hex")
    })
  )
  return { root, source }
}

test.each([
  ["darwin-arm64", "aarch64-apple-darwin", "libalwith_native_drive.dylib"],
  ["win32-x64", "x86_64-pc-windows-msvc", "alwith_native_drive.dll"]
])("stages the verified %s library and its notices", (platform, target, binary) => {
  const { root } = fixture(platform, target, binary)
  const path = stageDriveNative(root, target, join(root, "output"), join(root, "licenses"))
  expect(readFileSync(path, "utf8")).toBe("verified library")
  expect(readFileSync(join(root, "licenses/alwith-native-drive/THIRD_PARTY_NOTICES.md"), "utf8")).toBe("notices")
})

test("rejects modified bytes before staging a library", () => {
  const { root, source } = fixture("darwin-arm64", "aarch64-apple-darwin", "libalwith_native_drive.dylib")
  writeFileSync(join(source, "libalwith_native_drive.dylib"), "changed")
  expect(() => stageDriveNative(root, "aarch64-apple-darwin", join(root, "output"), join(root, "licenses"))).toThrow(
    "checksum mismatch"
  )
})

test("rejects an incompatible native protocol", () => {
  const { root, source } = fixture("darwin-arm64", "aarch64-apple-darwin", "libalwith_native_drive.dylib")
  const path = join(source, "artifact.json")
  const artifact = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
  writeFileSync(path, JSON.stringify({ ...artifact, contract: 1 }))
  expect(() => stageDriveNative(root, "aarch64-apple-darwin", join(root, "output"), join(root, "licenses"))).toThrow(
    "identity mismatch"
  )
})

test.each([
  ["editor", 1],
  ["fs", 1],
  ["auth", 2]
] as const)("stages the matching %s plugin library", (module, contract) => {
  const target = "aarch64-apple-darwin"
  const binary = `libalwith_native_${module}.dylib`
  const { root } = fixture("darwin-arm64", target, binary, module, contract)
  const path = stageModuleNative(module, contract, root, target, join(root, "output"), join(root, "licenses"))
  expect(readFileSync(path, "utf8")).toBe("verified library")
  expect(readFileSync(join(root, `licenses/alwith-native-${module}/THIRD_PARTY_NOTICES.md`), "utf8")).toBe("notices")
  expect(() =>
    stageModuleNative(module, contract + 1, root, target, join(root, "output"), join(root, "licenses"))
  ).toThrow("identity mismatch")
})
