import { expect, test } from "bun:test"
import { join } from "node:path"
import { runtimeBuildArtifact, runtimeSource, stageTarget } from "../runtime-artifact"

test("the npm package is the default; local Runtime builds require explicit opt-in", () => {
  expect(runtimeSource(undefined)).toBe("npm")
  expect(runtimeSource("npm")).toBe("npm")
  expect(runtimeSource("sibling")).toBe("sibling")
  expect(() => runtimeSource("")).toThrow("RUNTIME_SOURCE")
  expect(() => runtimeSource("auto")).toThrow("RUNTIME_SOURCE")
})

test("explicit staging target wins, then Tauri's build target, then the native host", () => {
  expect(stageTarget("explicit", "tauri", "native")).toBe("explicit")
  expect(stageTarget(undefined, "tauri", "native")).toBe("tauri")
  expect(stageTarget(undefined, undefined, "native")).toBe("native")
})

test("cross-target builds never take the native host Runtime artifact", () => {
  const host = "aarch64-apple-darwin"
  expect(runtimeBuildArtifact("runtime", host, host)).toBe(join("runtime", "target", "release", "alwith-runtime"))
  expect(runtimeBuildArtifact("runtime", "x86_64-pc-windows-msvc", host)).toBe(
    join("runtime", "target", "x86_64-pc-windows-msvc", "release", "alwith-runtime.exe")
  )
  expect(runtimeBuildArtifact("runtime", "aarch64-unknown-linux-gnu", host)).toBe(
    join("runtime", "target", "aarch64-unknown-linux-gnu", "release", "alwith-runtime")
  )
})
