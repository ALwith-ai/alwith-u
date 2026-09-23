import { expect, test } from "bun:test"
import manifest from "../../../package.json"
import { assertVersion, toolchainVersions } from "../toolchain"

test("all Bun and Codex platform pins match their authoritative versions", () => {
  expect(toolchainVersions(manifest)).toEqual({
    bun: manifest.packageManager.slice("bun@".length),
    codex: manifest.devDependencies["@openai/codex"]
  })
})

test("rejects floating toolchain versions and mismatched platform pins", () => {
  expect(() => toolchainVersions({ ...manifest, packageManager: "bun@latest" })).toThrow("exact Bun version")
  const bunMismatch = structuredClone(manifest)
  bunMismatch.optionalDependencies["@oven/bun-windows-aarch64"] = "0.0.0"
  expect(() => toolchainVersions(bunMismatch)).toThrow("@oven/bun-windows-aarch64: expected")
  const codexMismatch = structuredClone(manifest)
  codexMismatch.optionalDependencies["@openai/codex-linux-x64"] = "npm:@openai/codex@0.0.0-linux-x64"
  expect(() => toolchainVersions(codexMismatch)).toThrow("@openai/codex-linux-x64: expected")
})

test("rejects missing or stale installed artifacts", () => {
  expect(() => assertVersion("Bun artifact", undefined, "1.4.0")).toThrow("got missing")
  expect(() => assertVersion("Codex artifact", "0.153.0", "0.154.0")).toThrow("got 0.153.0")
  expect(() => assertVersion("Bun artifact", "1.4.0", "1.4.0")).not.toThrow()
})
