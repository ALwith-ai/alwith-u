import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"
import { must } from "@/lib/__tests__/must"
import { pluginIconSrc } from "../plugin-icon"

test("canonical names use Desktop's stable hash into the Figma collection", (): void => {
  expect(pluginIconSrc("alpha").split("#")[1]).toBe("plugin-ladybug")
  expect(pluginIconSrc("beta").split("#")[1]).toBe("plugin-map")
  expect(pluginIconSrc("").split("#")[1]).toBe("plugin-agent-mode")
  pluginIconSrc("another-plugin")
  expect(pluginIconSrc("alpha").split("#")[1]).toBe("plugin-ladybug")
})

test("every assigned icon resolves to the shared sprite with isolated paint references", async (): Promise<void> => {
  const source = readFileSync(join(__dirname, "../plugin-icons.svg"), "utf8")
  const document = new DOMParser().parseFromString(source, "image/svg+xml")
  expect(document.querySelector("parsererror")).toBeNull()
  const symbols = [...document.querySelectorAll("symbol")]
  expect(symbols).toHaveLength(65)
  const ids = [...document.querySelectorAll("[id]")].map(element => element.id)
  expect(new Set(ids).size).toBe(ids.length)
  const assigned = new Set<string>()
  // Exercise all modulo-997 hash values, covering every pool entry.
  for (let value = 0; value < 997; value++) {
    const src = pluginIconSrc(String.fromCharCode(value))
    expect(src.startsWith("#plugin-")).toBe(true)
    assigned.add(src.slice(1))
  }
  expect([...assigned].sort()).toEqual(symbols.map(symbol => symbol.id).sort())
  for (const symbol of symbols) {
    expect(symbol.getAttribute("viewBox")).toBe("0 0 36 36")
    expect(symbol.querySelector("path")).not.toBeNull()
    for (const element of symbol.querySelectorAll("*")) {
      for (const attribute of element.attributes) {
        for (const reference of attribute.value.matchAll(/url\(#([^)]+)\)/g)) {
          const id = must(reference[1], "paint reference")
          expect(id.startsWith(`${symbol.id}-`)).toBe(true)
          expect(ids.includes(id)).toBe(true)
        }
        if (attribute.localName === "href") expect(ids.includes(attribute.value.slice(1))).toBe(true)
      }
    }
  }
  for (const reference of source.matchAll(/url\(#([^)]+)\)/g)) {
    expect(ids.includes(must(reference[1], "paint reference"))).toBe(true)
  }
})
