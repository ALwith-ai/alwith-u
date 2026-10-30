import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { build } from "vite"

test("license collection ignores directories and retains the package license text", async () => {
  const root = await mkdtemp(join(tmpdir(), "alwith-license-build-"))
  try {
    const pkg = join(root, "node_modules/license-fixture")
    await mkdir(join(pkg, "LICENSE"), { recursive: true })
    await writeFile(join(pkg, "LICENSE.txt"), "Fixture license text")
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({ name: "license-fixture", version: "1.0.0", main: "index.js", license: "MIT" })
    )
    await writeFile(join(pkg, "index.js"), "export const value = globalThis.crypto.randomUUID()")
    await writeFile(join(root, "index.html"), '<script type="module" src="./main.js"></script>')
    await writeFile(join(root, "main.js"), 'import { value } from "license-fixture"; window.fixture = value')
    const result = await build({
      root,
      configFile: false,
      logLevel: "silent",
      build: { write: false, license: { fileName: "licenses.json" } }
    })
    if (Array.isArray(result) || !("output" in result)) throw new Error("Expected one frontend build")
    const license = result.output.find((entry) => entry.fileName === "licenses.json")
    if (license?.type !== "asset") throw new Error("Missing license output")
    expect(JSON.parse(String(license.source))).toContainEqual({
      name: "license-fixture",
      version: "1.0.0",
      identifier: "MIT",
      text: "Fixture license text"
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
