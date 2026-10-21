import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import tauri from "../../../src-tauri/tauri.conf.json"
import providers from "../../../src/lib/provider-catalog.json"

interface CatalogModel {
  slug: string
  default_reasoning_level?: string | null
  supported_reasoning_levels: Array<{ effort: string }>
  input_modalities: string[]
}

for (const provider of providers) {
  test(`${provider.id}: every selectable model has packaged metadata`, () => {
    expect(provider.catalog, `${provider.id}: missing catalog`).toBeString()
    if (!provider.catalog) throw new Error(`${provider.id}: missing catalog`)
    const directory = provider.catalog.split("/")[0]
    expect(tauri.bundle.resources).toHaveProperty(`resources/${directory}`, directory)
    const catalog = JSON.parse(
      readFileSync(resolve(import.meta.dir, "../../../src-tauri/resources", provider.catalog), "utf8")
    ) as { models: CatalogModel[] }
    const slugs = catalog.models.map((model) => model.slug)
    expect(new Set(slugs).size, `${provider.id}: duplicate metadata slugs`).toBe(slugs.length)
    expect(new Set(provider.models.map((model) => model.id)).size).toBe(provider.models.length)
    for (const configured of provider.models) {
      const model = catalog.models.find((entry) => entry.slug === configured.id)
      expect(model, `${provider.id}/${configured.id}: missing metadata`).toBeDefined()
      if (!model) throw new Error(`Missing metadata: ${configured.id}`)
      if (model.default_reasoning_level != null) {
        expect(model.supported_reasoning_levels.map((level) => level.effort)).toContain(model.default_reasoning_level)
      }
      expect(model.input_modalities).toContain("text")
    }
  })
}

test("Qwen 3.8 exposes its documented levels without compatibility aliases", () => {
  const provider = providers.find((entry) => entry.id === "qwen")
  expect(provider?.catalog).toBe("qwen/models.json")
  const catalog = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../../../src-tauri/resources/qwen/models.json"), "utf8")
  ) as {
    models: Array<{
      slug: string
      default_reasoning_level: string
      supported_reasoning_levels: Array<{ effort: string }>
    }>
  }
  for (const slug of ["qwen3.8-max", "qwen3.8-flash"]) {
    const model = catalog.models.find((entry) => entry.slug === slug)
    expect(model?.default_reasoning_level).toBe("xhigh")
    expect(model?.supported_reasoning_levels.map((entry) => entry.effort)).toEqual(["none", "low", "medium", "xhigh"])
  }
  expect(tauri.bundle.resources).toHaveProperty("resources/qwen", "qwen")
})
