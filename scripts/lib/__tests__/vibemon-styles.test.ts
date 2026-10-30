import { expect, test } from "bun:test"
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import tailwindcss from "@tailwindcss/vite"
import { build } from "vite"

test("the application stylesheet includes Vibemon utilities from published shared chunks", async () => {
  const root = await mkdtemp(join(tmpdir(), "alwith-vibemon-styles-"))
  try {
    await symlink(resolve(import.meta.dirname, "../../../node_modules"), join(root, "node_modules"))
    await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }))
    await writeFile(join(root, "index.html"), '<script type="module" src="./main.js"></script>')
    await writeFile(
      join(root, "main.js"),
      `import ${JSON.stringify(resolve(import.meta.dirname, "../../../src/index.css"))};`
    )
    const result = await build({
      root,
      configFile: false,
      publicDir: false,
      logLevel: "silent",
      plugins: [tailwindcss()],
      build: { write: false, cssMinify: false }
    })
    if (Array.isArray(result) || !("output" in result)) throw new Error("Expected one frontend build")
    const css = result.output
      .filter((file) => file.type === "asset" && file.fileName.endsWith(".css"))
      .map((file) => (file.type === "asset" ? String(file.source) : ""))
      .join("\n")
    for (const selector of [
      String.raw`.\[container-type\:size\]`,
      String.raw`.top-\[83\.050\%\]`,
      String.raw`.w-\[52\.083\%\]`,
      String.raw`.h-\[8\.5cqh\]`,
      String.raw`.rounded-\[6\.25cqw\]`
    ])
      expect(css.includes(selector), `Missing Vibemon layout utility: ${selector}`).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
