import { expect, test } from "bun:test"
import { join } from "node:path"
import { runtimeBuildArtifact, runtimeReleaseCache, runtimeSource, stageTarget } from "../runtime-artifact"

test("release is the default; local Runtime builds require explicit opt-in", () => {
  expect(runtimeSource(undefined)).toBe("release")
  expect(runtimeSource("release")).toBe("release")
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

test("release caches isolate target architectures as well as versions", () => {
  const paths = [
    runtimeReleaseCache("binaries", "0.4.0", "aarch64-apple-darwin"),
    runtimeReleaseCache("binaries", "0.4.0", "x86_64-unknown-linux-gnu"),
    runtimeReleaseCache("binaries", "0.4.1", "aarch64-apple-darwin")
  ]
  expect(new Set(paths).size).toBe(3)
  expect(paths[0]).toBe(join("binaries", ".alwith-runtime", "0.4.0", "aarch64-apple-darwin"))
})
