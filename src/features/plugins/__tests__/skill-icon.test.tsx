import { readFileSync } from "node:fs"
import { join } from "node:path"

import { cleanup, render } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"

import { must } from "@/lib/__tests__/must"

import { SkillIcon, skillIconSrc } from "../skill-icon"

afterEach(cleanup)

test("exactly six canonical skill names use dedicated Figma assets; every other name uses Default", () => {
  const names = ["openai-docs", "imagegen", "alwith-docs", "skill-creator", "skill-installer", "review-agent"]
  expect(new Set(names.map(skillIconSrc)).size).toBe(6)
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
