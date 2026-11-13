import { readFileSync } from "node:fs"
import { join } from "node:path"

import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { must } from "@/lib/__tests__/must"

import { SkillIcon, skillIconSrc } from "../skill-icon"

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`
}))

afterEach(cleanup)

const localOnly = { iconSmallUrl: null, iconLargeUrl: null }

test("exactly six canonical skill names use dedicated Figma assets; every other name uses Default", () => {
  const names = ["openai-docs", "imagegen", "alwith-docs", "skill-creator", "skill-installer", "review-agent"]
  expect(new Set(names.map((name) => skillIconSrc(name))).size).toBe(6)
  for (const name of names) {
    expect(skillIconSrc(name)).not.toBe(skillIconSrc(""))
    const view = render(<SkillIcon name={name} />)
    expect(view.container.querySelector("img")).toHaveAttribute("src", skillIconSrc(name))
    view.unmount()
  }
  for (const name of [
    "alpha",
    "beta",
    "Review Agent",
    "ReviewAgent",
    "OpenAI Docs",
    "vendor:imagegen",
    "toString",
    "__proto__"
  ])
    expect(skillIconSrc(name)).toBe(skillIconSrc(""))
})

test("exported Figma assets preserve their complete 36px canvas and self-contained paints", () => {
  for (const name of [
    "default",
    "openai-docs",
    "imagegen",
    "alwith-docs",
    "skill-creator",
    "skill-installer",
    "review-agent"
  ]) {
    const source = readFileSync(join(__dirname, `../icons/${name}.svg`), "utf8")
    const document = new DOMParser().parseFromString(source, "image/svg+xml")
    expect(document.querySelector("parsererror")).toBeNull()
    const root = document.documentElement
    expect(root.getAttribute("viewBox")).toBe("0 0 36 36")
    expect(root.getAttribute("width")).toBe("36")
    expect(root.getAttribute("height")).toBe("36")
    expect(document.querySelector("path")).not.toBeNull()
    expect([...root.children].some((child) => child.tagName === "rect")).toBe(false)
    const container = must(document.querySelector('[id="Skill-Icon"]'), "icon container")
    expect([...container.children].every((child) => child.tagName === "g")).toBe(true)
    const ids = new Set([...document.querySelectorAll("[id]")].map((node) => node.id))
    for (const reference of source.matchAll(/url\(#([^)]+)\)/g))
      expect(ids.has(must(reference[1], "paint id"))).toBe(true)
  }
})

test("catalog URLs take precedence over local skill paths and name-based assets", () => {
  const remote = "https://files.openai.com/content?id=skill-icon"
  const info = { iconSmallUrl: remote, iconLargeUrl: null, iconSmall: "/Users/test/.codex/skills/imagegen/icon.svg" }
  expect(skillIconSrc("imagegen", info)).toBe(remote)
  expect(skillIconSrc("imagegen", { ...info, iconSmallUrl: null, iconLargeUrl: remote })).toBe(remote)
  expect(skillIconSrc("imagegen", { ...info, iconSmallUrl: null })).not.toBe(skillIconSrc("imagegen"))
  const view = render(<SkillIcon name="imagegen" info={info} />)
  expect(view.container.querySelector("img")).toHaveAttribute("src", remote)
})

test("a failed remote icon uses local assets and changed metadata retries the remote", () => {
  const info = {
    ...localOnly,
    iconSmallUrl: "https://example.com/icon.svg",
    iconSmall: "/Users/test/.codex/skills/imagegen/small.svg",
    iconLarge: "/Users/test/.codex/skills/imagegen/large.svg"
  }
  const view = render(<SkillIcon name="imagegen" info={info} />)
  const image = must(view.container.querySelector("img"), "skill icon")
  fireEvent.error(image)
  expect(image).toHaveAttribute("src", skillIconSrc("imagegen", { ...localOnly, iconSmall: info.iconSmall }))
  fireEvent.error(image)
  expect(image).toHaveAttribute("src", skillIconSrc("imagegen", { ...localOnly, iconLarge: info.iconLarge }))
  fireEvent.error(image)
  expect(image).toHaveAttribute("src", skillIconSrc("imagegen"))
  fireEvent.error(image)
  expect(image).toHaveAttribute("src", skillIconSrc(""))
  fireEvent.error(image)
  expect(image).toHaveAttribute("src", skillIconSrc(""))

  view.rerender(<SkillIcon name="imagegen" info={{ ...info, iconSmallUrl: "https://example.com/new.svg" }} />)
  expect(view.container.querySelector("img")).toHaveAttribute("src", "https://example.com/new.svg")
})

test("missing remote URLs use the local path, and remote failure without a local path uses the bundled icon", () => {
  const info = { ...localOnly, iconLarge: "/tmp/local.svg" }
  const view = render(<SkillIcon name="imagegen" info={info} />)
  expect(view.container.querySelector("img")).toHaveAttribute("src", skillIconSrc("imagegen", info))
  view.rerender(<SkillIcon name="imagegen" info={{ ...localOnly, iconLargeUrl: "https://example.com/large.svg" }} />)
  fireEvent.error(must(view.container.querySelector("img"), "skill icon"))
  expect(view.container.querySelector("img")).toHaveAttribute("src", skillIconSrc("imagegen"))
})
