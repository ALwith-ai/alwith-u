import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

test("module-chat owns the adapter dependency and its patches", () => {
  const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../package.json"), "utf8")) as Record<
    string,
    Record<string, unknown>
  >
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
    "overrides",
    "resolutions",
    "patchedDependencies"
  ]) {
    const adapters = Object.keys(manifest[field] ?? {}).filter((name) => name.includes("codex-acp"))
    expect(adapters, field).toEqual([])
  }
  expect(manifest.dependencies["@alwith/module-chat"]).toBeDefined()
})
