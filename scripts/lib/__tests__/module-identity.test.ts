import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { win32 } from "node:path"
import { fileURLToPath } from "node:url"

import { build, type Plugin } from "vite"

import { moduleIdentityGuard } from "../module-identity"

// Run the installed resolver with Windows filesystem semantics on every CI OS.
// Vite resolves relative imports with forward slashes; the alias must match it.
async function windowsResolver(): Promise<Plugin> {
  const source = await readFile(fileURLToPath(import.meta.resolve("@nyssance/shadcn/vite")), "utf8")
  const factory = new Function(
    "existsSync",
    "statSync",
    "dirname",
    "join",
    "resolve",
    source.replace(/^import .*;$/gm, "").replace(/export\s*\{\s*shadcn\s*\};?\s*$/, "return shadcn;")
  )
  const shadcn = factory(
    (file: string) => file === "C:\\fixture\\src\\store.js",
    () => ({ isFile: () => true }),
    win32.dirname,
    win32.join,
    win32.resolve
  )
  return shadcn({ src: "C:\\fixture\\src", style: "vega" })
}

async function fixture(resolver: Plugin, guard = false) {
  const files: Record<string, string> = {
    "C:/fixture/src/main.js": `import { store } from '@/store'; import { loading } from './gate.js'; store.init(); export const stuck = loading();`,
    "C:/fixture/src/gate.js": `import { store } from './store.js'; export const loading = () => store.loading;`,
    "C:/fixture/src/store.js": `export const store = { loading: true, init() { this.loading = false } };`
  }
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      resolver,
      {
        name: "windows-fixture",
        resolveId(source, importer) {
          if (source === "entry") return "C:/fixture/src/main.js"
          if (source.startsWith(".") && importer)
            return win32.resolve(win32.dirname(importer), source).replaceAll("\\", "/")
        },
        load(id) {
          return files[id.replaceAll("\\", "/")]
        }
      },
      ...(guard ? [moduleIdentityGuard()] : [])
    ],
    build: {
      write: false,
      minify: false,
      rolldownOptions: { input: "entry", preserveEntrySignatures: "strict" }
    }
  })
  if (Array.isArray(result) || !("output" in result)) throw new Error("Expected one build")
  const entry = result.output.find((item) => item.type === "chunk" && item.isEntry)
  if (entry?.type !== "chunk") throw new Error("Missing entry chunk")
  return import(`data:text/javascript;base64,${Buffer.from(entry.code).toString("base64")}`)
}

const brokenResolver = (): Plugin => ({
  name: "original-windows-alias",
  enforce: "pre",
  resolveId(source) {
    if (source === "@/store") return "C:\\fixture\\src\\store.js"
  }
})

test("reproduces Loading when alias and relative imports create separate stores", async () => {
  expect((await fixture(brokenResolver())).stuck).toBe(true)
})

test("the installed shadcn resolver shares the initialized store on Windows", async () => {
  expect((await fixture(await windowsResolver(), true)).stuck).toBe(false)
})

test("production builds reject duplicate Windows module identities", async () => {
  await expect(fixture(brokenResolver(), true)).rejects.toThrow("Duplicate module identity")
})
