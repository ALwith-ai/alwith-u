import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { PluginSummary } from "@alwith/module-chat/client"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { createElement } from "react"
import { afterEach, expect, test, vi } from "vitest"

import { must } from "@/lib/__tests__/must"

import { PluginIcon, pluginIconSrc } from "../plugin-icon"

const theme = vi.hoisted(() => ({ resolvedTheme: "light" }))
vi.mock("@/components/theme-provider", () => ({ useTheme: () => theme }))
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`
}))
afterEach(cleanup)

test("canonical names use Desktop's stable hash into the Figma collection", (): void => {
  expect(pluginIconSrc("alpha").split("#")[1]).toBe("plugin-ladybug")
  expect(pluginIconSrc("beta").split("#")[1]).toBe("plugin-map")
  expect(pluginIconSrc("").split("#")[1]).toBe("plugin-agent-mode")
  pluginIconSrc("another-plugin")
  expect(pluginIconSrc("alpha").split("#")[1]).toBe("plugin-ladybug")
})

test("every assigned icon resolves to the shared sprite with isolated paint references", (): Promise<void> => {
  return Promise.try(() => {
    const source = readFileSync(join(__dirname, "../plugin-icons.svg"), "utf8")
    const document = new DOMParser().parseFromString(source, "image/svg+xml")
    expect(document.querySelector("parsererror")).toBeNull()
    const symbols = [...document.querySelectorAll("symbol")]
    expect(symbols).toHaveLength(65)
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
    const assigned = new Set<string>()
    // Exercise all modulo-997 hash values, covering every pool entry.
    for (let value = 0; value < 997; value++) {
      const src = pluginIconSrc(String.fromCharCode(value))
      expect(src.startsWith("#plugin-")).toBe(true)
      assigned.add(src.slice(1))
    }
    expect([...assigned].toSorted()).toEqual(symbols.map((symbol) => symbol.id).toSorted())
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
})

test("official catalog logos override local icons and follow the app theme", () => {
  const light = "https://files.openai.com/content?id=light"
  const dark = "https://files.openai.com/content?id=dark"
  const info: NonNullable<PluginSummary["interface"]> = {
    displayName: null,
    shortDescription: null,
    longDescription: null,
    developerName: null,
    category: null,
    capabilities: [],
    websiteUrl: null,
    privacyPolicyUrl: null,
    termsOfServiceUrl: null,
    defaultPrompt: null,
    brandColor: null,
    composerIcon: "/Users/test/.codex/plugins/icon.svg",
    composerIconUrl: null,
    logo: "/Users/test/.codex/plugins/logo.svg",
    logoDark: null,
    logoUrl: light,
    logoUrlDark: dark,
    screenshots: [],
    screenshotUrls: []
  }
  const view = render(createElement(PluginIcon, { name: "alpha", info }))
  expect(view.container.querySelector("img")).toHaveAttribute("src", light)
  theme.resolvedTheme = "dark"
  view.rerender(createElement(PluginIcon, { name: "alpha", info }))
  expect(view.container.querySelector("img")).toHaveAttribute("src", dark)
  theme.resolvedTheme = "light"
  view.rerender(
    createElement(PluginIcon, {
      name: "alpha",
      info: { ...info, logoUrl: null, logoUrlDark: null, composerIconUrl: light }
    })
  )
  expect(view.container.querySelector("img")).toHaveAttribute("src", light)
  for (const resolvedTheme of ["light", "dark"]) {
    theme.resolvedTheme = resolvedTheme
    for (const remoteFields of [
      { logoUrl: light, logoUrlDark: null, composerIconUrl: null },
      { logoUrl: null, logoUrlDark: dark, composerIconUrl: null },
      { logoUrl: null, logoUrlDark: null, composerIconUrl: light }
    ]) {
      view.rerender(
        createElement(PluginIcon, {
          name: "alpha",
          info: { ...info, ...remoteFields, logoDark: "/Users/test/.codex/plugins/dark.svg" }
        })
      )
      expect(view.container.querySelector("img")).toHaveAttribute("src", remoteFields.logoUrlDark ?? light)
    }
  }
  theme.resolvedTheme = "light"

  fireEvent.error(must(view.container.querySelector("img"), "plugin logo"))
  expect(view.container.querySelector("img")).toBeNull()
  expect(view.container.querySelector("use")).toHaveAttribute("href", pluginIconSrc("alpha"))
  view.rerender(
    createElement(PluginIcon, { name: "alpha", info: { ...info, logoUrl: "https://example.com/second.svg" } })
  )
  expect(view.container.querySelector("img")).toHaveAttribute("src", "https://example.com/second.svg")
})
