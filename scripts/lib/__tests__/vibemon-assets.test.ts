import { expect, test } from "bun:test"
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { build } from "vite"

for (const base of ["/", "./"]) {
  test(`packaged Vibemon assets build for multiple windows with base ${base}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "alwith-vibemon-assets-"))
    try {
      await symlink(resolve(import.meta.dirname, "../../../node_modules"), join(root, "node_modules"))
      await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }))
      const html = '<script type="module" src="./main.js"></script>'
      await writeFile(join(root, "index.html"), html)
      await writeFile(join(root, "vibemon.html"), html)
      await writeFile(
        join(root, "main.js"),
        'import { PetCenter, PetWindow } from "@alwith/module-vibemon/react"; import "@alwith/module-vibemon/styles.css"; window.components = { PetCenter, PetWindow };'
      )
      const result = await build({
        root,
        base,
        configFile: false,
        publicDir: false,
        logLevel: "silent",
        resolve: { dedupe: ["react", "react-dom", "@base-ui/react"] },
        build: {
          write: false,
          assetsInlineLimit: 0,
          target: "safari13",
          rollupOptions: { input: [join(root, "index.html"), join(root, "vibemon.html")] }
        }
      })
      if (Array.isArray(result) || !("output" in result)) throw new Error("Expected one frontend build")
      const files = new Set(result.output.map(file => file.fileName))
      expect(files.has("index.html")).toBe(true)
      expect(files.has("vibemon.html")).toBe(true)
      for (const name of [
        "intro",
        "pull",
        "GrowYear",
        "Outfit-Variable",
        "burst-sheet",
        "home-bg",
        "vibemon-icon-hover",
        "wish-text",
        "album-icon-hover",
        "proceed-default",
        "proceed-hover",
        "proceed-active"
      ])
        expect([...files].some(file => basename(file).startsWith(`${name}-`))).toBe(true)
      expect([...files].filter(file => /\.(mp4|webm)$/.test(file))).toHaveLength(3)

      let references = 0
      for (const file of result.output) {
        const source = file.type === "chunk" ? file.code : typeof file.source === "string" ? file.source : ""
        expect(source).not.toMatch(/["']\/(?:vibemon|card-draw)\//)
        expect(source).not.toContain("node_modules/@alwith/module-vibemon/assets")
        for (const match of source.matchAll(/([^"'`\s()]+-[\w-]{8}\.(?:png|webp|svg|mp4|webm|woff2))/g)) {
          const url = new URL(match[1], `https://fixture.invalid/${file.fileName}`)
          expect(files.has(url.pathname.slice(1))).toBe(true)
          references++
        }
      }
      expect(references).toBeGreaterThan(30)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30000)
}
