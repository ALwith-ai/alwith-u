import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { build } from "vite"

import { productionJsxGuard } from "../production-jsx"

async function buildFixture(runtime: "jsx-runtime" | "jsx-dev-runtime", factory: "jsx" | "jsxDEV", runtimeLabel = "") {
  const directory = await mkdtemp(join(tmpdir(), "u-production-jsx-"))
  try {
    const entry = join(directory, "fixture.js")
    await writeFile(
      entry,
      `import { ${factory} } from "react/${runtime}"; export const icon = ${factory}("svg", {}); export const label = ${JSON.stringify(runtimeLabel)};`
    )
    return await build({
      configFile: false,
      logLevel: "silent",
      plugins: [productionJsxGuard()],
      build: {
        write: false,
        lib: { entry, formats: ["es"], fileName: "fixture" },
        rolldownOptions: { external: [`react/${runtime}`] }
      }
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("rejects a precompiled dependency using development JSX", async () => {
  await expect(buildFixture("jsx-dev-runtime", "jsxDEV")).rejects.toThrow("Development JSX in production bundle")
})

test("allows precompiled production JSX", async () => {
  await expect(buildFixture("jsx-runtime", "jsx")).resolves.toBeDefined()
})

test("allows extension runtime names that are data rather than imports", async () => {
  await expect(buildFixture("jsx-runtime", "jsx", "react/jsx-dev-runtime")).resolves.toBeDefined()
})
