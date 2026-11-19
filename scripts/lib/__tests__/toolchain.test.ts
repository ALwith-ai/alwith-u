import { expect, test } from "bun:test"

import manifest from "../../../package.json"
import { assertVersion, toolchainVersions } from "../toolchain"

test("the manifest pins both Bun versions", () => {
  expect(toolchainVersions(manifest)).toEqual({
    buildBun: manifest.packageManager.slice("bun@".length),
    bun: manifest.optionalDependencies["@oven/bun-darwin-aarch64"]
  })
})

test("the bundled Bun is pinned independently of the build Bun", () => {
  const split = structuredClone(manifest)
  split.packageManager = "bun@1.0.0"
  expect(toolchainVersions(split).buildBun).toBe("1.0.0")
  expect(toolchainVersions(split).bun).toBe(manifest.optionalDependencies["@oven/bun-darwin-aarch64"])
})

test("rejects floating toolchain versions and mismatched platform pins", () => {
  expect(() => toolchainVersions({ ...manifest, packageManager: "bun@latest" })).toThrow("exact Bun version")
  const bunMismatch = structuredClone(manifest)
  bunMismatch.optionalDependencies["@oven/bun-windows-x64-baseline"] = "0.0.0"
  expect(() => toolchainVersions(bunMismatch)).toThrow("@oven/bun-windows-x64-baseline: expected")
})

test("Codex is never declared by the application", () => {
  const declared = { ...manifest, devDependencies: { ...manifest.devDependencies, "@openai/codex": "latest" } }
  expect(() => toolchainVersions(declared)).toThrow("Codex comes with @alwith/module-chat")
  const platform = {
    ...manifest,
    optionalDependencies: { ...manifest.optionalDependencies, "@openai/codex-darwin-arm64": "0.170.0" }
  }
  expect(() => toolchainVersions(platform)).toThrow("Codex comes with @alwith/module-chat")
})

test("rejects missing or stale installed artifacts", () => {
  expect(() => assertVersion("Bun artifact", undefined, "1.4.0")).toThrow("got missing")
  expect(() => assertVersion("Codex artifact", "0.153.0", "0.154.0")).toThrow("got 0.153.0")
  expect(() => assertVersion("Bun artifact", "1.4.0", "1.4.0")).not.toThrow()
})
