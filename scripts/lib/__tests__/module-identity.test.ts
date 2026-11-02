import { expect, test } from "bun:test"
import { win32 } from "node:path"

import { build, type Plugin } from "vite"

import { moduleIdentityGuard } from "../module-identity"

// Emulate a Windows build on every CI OS. Vite resolves relative imports with forward slashes; the alias must match it.
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
  const module: unknown = await import(`data:text/javascript;base64,${Buffer.from(entry.code).toString("base64")}`)
  if (typeof module !== "object" || module === null || !("stuck" in module) || typeof module.stuck !== "boolean")
    throw new Error("Entry chunk does not export stuck")
  return module.stuck
}

const aliasResolver = (id: string): Plugin => ({
  name: "windows-alias",
  enforce: "pre",
  resolveId(source) {
    if (source === "@/store") return id
  }
})

test("reproduces Loading when alias and relative imports create separate stores", async () => {
  expect(await fixture(aliasResolver(String.raw`C:\fixture\src\store.js`))).toBe(true)
})

test("a normalized alias shares the initialized store", async () => {
  expect(await fixture(aliasResolver("C:/fixture/src/store.js"), true)).toBe(false)
})

test("production builds reject duplicate Windows module identities", async () => {
  await expect(fixture(aliasResolver(String.raw`C:\fixture\src\store.js`), true)).rejects.toThrow(
    "Duplicate module identity"
  )
})
