import { expect, test } from "bun:test"
import { readdir, stat } from "node:fs/promises"
import { pluginIconSrc } from "../plugin-icon"

test("canonical names use Desktop's stable hash into the Figma collection", (): void => {
  expect(pluginIconSrc("alpha")).toBe("/plugin-icons/ladybug.svg")
  expect(pluginIconSrc("beta")).toBe("/plugin-icons/map.svg")
  expect(pluginIconSrc("")).toBe("/plugin-icons/agent-mode.svg")
  pluginIconSrc("another-plugin")
  expect(pluginIconSrc("alpha")).toBe("/plugin-icons/ladybug.svg")
})

test("every assigned icon exists locally as a non-empty original-size SVG", async (): Promise<void> => {
  const directory = new URL("../../../../public/plugin-icons/", import.meta.url)
  const files = (await readdir(directory)).filter(name => name.endsWith(".svg"))
  expect(files).toHaveLength(65)
  const assigned = new Set<string>()
  // Exercise all modulo-997 hash values, covering every pool entry.
  for (let value = 0; value < 997; value++) {
    const src = pluginIconSrc(String.fromCharCode(value))
    expect(src.startsWith("/plugin-icons/")).toBe(true)
    assigned.add(src.slice("/plugin-icons/".length))
  }
  expect([...assigned].sort()).toEqual(files.sort())
  for (const file of files) {
    const url = new URL(file, directory)
    expect((await stat(url)).size).toBeGreaterThan(100)
    const root = (await Bun.file(url).text()).split(">", 1)[0]
    expect(root).toContain('width="36"')
    expect(root).toContain('height="36"')
    expect(root).toContain('viewBox="0 0 36 36"')
  }
})
