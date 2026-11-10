import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { dependencyPatchReload } from "../dependency-patches"

test("patch contents change Vite's cache identity without a package version bump", () => {
  const root = mkdtempSync(path.join(tmpdir(), "alwith-patch-cache-"))
  try {
    const patches = path.join(root, "patches")
    mkdirSync(patches)
    const file = path.join(patches, "chat.patch")
    writeFileSync(file, "first build")
    const first = dependencyPatchReload(root).name
    expect(dependencyPatchReload(root).name).toBe(first)
    writeFileSync(file, "second build")
    expect(dependencyPatchReload(root).name).not.toBe(first)
    writeFileSync(file, "first build")
    expect(dependencyPatchReload(root).name).toBe(first)
    writeFileSync(path.join(patches, "other.patch"), "another dependency")
    expect(dependencyPatchReload(root).name).not.toBe(first)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
