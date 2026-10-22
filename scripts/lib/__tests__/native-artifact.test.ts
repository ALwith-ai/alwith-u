import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const temporary: string[] = []
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "alwith-native-contract-"))
  temporary.push(root)
  const bridge = join(root, "node_modules/@alwith/native-auth")
  const platform = join(root, "node_modules/@alwith/native-auth-darwin-arm64")
  mkdirSync(bridge, { recursive: true })
  mkdirSync(join(platform, "licenses"), { recursive: true })
  cpSync(
    join(dirname(import.meta.resolve("@alwith/native-auth/stage").replace("file://", "")), "stage.js"),
    join(bridge, "stage.mjs")
  )
  const kit = join(root, "node_modules/@alwith/native-kit")
  cpSync(dirname(fileURLToPath(import.meta.resolve("@alwith/native-kit/stage"))), kit, { recursive: true })
  writeFileSync(
    join(bridge, "package.json"),
    JSON.stringify({
      name: "@alwith/native-auth",
      version: "0.1.0",
      optionalDependencies: { "@alwith/native-auth-darwin-arm64": "0.1.0" }
    })
  )
  writeFileSync(
    join(platform, "package.json"),
    JSON.stringify({ name: "@alwith/native-auth-darwin-arm64", version: "0.1.0" })
  )
  const bytes = "fixture bytes, never loaded or executed"
  writeFileSync(join(platform, "libalwith_native_auth.dylib"), bytes)
  const pin = {
    module: "auth",
    version: "0.1.0",
    target: "aarch64-apple-darwin",
    abi: 1,
    binary: "libalwith_native_auth.dylib",
    sha256: createHash("sha256").update(bytes).digest("hex")
  }
  writeFileSync(join(platform, "artifact.json"), JSON.stringify(pin))
  for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) writeFileSync(join(platform, name), "fixture licence")
  const { stageNative } = (await import(pathToFileURL(join(bridge, "stage.mjs")).href)) as {
    stageNative: (target: string, native: string, legal: string) => string
  }
  return {
    root,
    platform,
    pin,
    stage: () => stageNative("aarch64-apple-darwin", join(root, "native"), join(root, "legal"))
  }
}

test("native npm staging validates the binary and carries its licences", async () => {
  const f = await fixture()
  expect(readFileSync(f.stage(), "utf8")).toBe("fixture bytes, never loaded or executed")
  expect(readFileSync(join(f.root, "legal/alwith-native-auth/LICENSE"), "utf8")).toBe("fixture licence")
})

test("a corrupted native binary is rejected before staging", async () => {
  const f = await fixture()
  writeFileSync(join(f.platform, "libalwith_native_auth.dylib"), "corrupt")
  expect(f.stage).toThrow("checksum mismatch")
})

test("native version, target and ABI mismatches are rejected", async () => {
  const f = await fixture()
  for (const change of [
    { module: "installed-apps" },
    { version: "9.0.0" },
    { target: "x86_64-apple-darwin" },
    { abi: 2 },
    { binary: "../../outside" }
  ]) {
    writeFileSync(join(f.platform, "artifact.json"), JSON.stringify({ ...f.pin, ...change }))
    expect(f.stage).toThrow("identity mismatch")
  }
})
