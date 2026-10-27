import * as core from "@tauri-apps/api/core"
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { readSkillDocument, SkillDocument, skillMarkdownBody } from "../skill-document"

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  invoke: vi.fn()
}))

vi.mock("@/components/theme-provider", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }))

beforeEach(async () => {
  await initI18n("en")
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test("reads the actual skill file through the shared filesystem adapter", async () => {
  const invoke = vi.mocked(core.invoke).mockImplementation((command) => {
    if (command === "workspace_open") return Promise.resolve("/skills/research")
    if (command === "workspace_file")
      return Promise.resolve([...new TextEncoder().encode("# Instructions\nUse evidence.")])
    return Promise.reject(new Error("Unexpected command"))
  })
  expect(await readSkillDocument("/skills/research/SKILL.md")).toBe("# Instructions\nUse evidence.")
  expect(invoke).toHaveBeenCalledWith("workspace_open", { path: "/skills/research" })
  expect(invoke).toHaveBeenCalledWith("workspace_file", {
    request: { root: "/skills/research", operation: "readFile", path: "/skills/research/SKILL.md" }
  })
})

test("removes only leading frontmatter, preserving Markdown separators and fenced code", () => {
  expect(skillMarkdownBody("---\r\nname: Test\r\n---\r\n# Guide\n\n---\n\n```js\nrun()\n```")).toBe(
    "# Guide\n\n---\n\n```js\nrun()\n```"
  )
  expect(skillMarkdownBody("# Guide\n---\nText")).toBe("# Guide\n---\nText")
})

test("shows read errors and retries into rendered Markdown", async () => {
  let failed = true
  vi.mocked(core.invoke).mockImplementation((command) => {
    if (failed) return Promise.reject(new Error("File unavailable"))
    if (command === "workspace_open") return Promise.resolve("/skills")
    return Promise.resolve([
      ...new TextEncoder().encode("---\nname: hidden-metadata\n---\n# Instructions\n\nUse **evidence**.")
    ])
  })
  const view = render(<SkillDocument path="/skills/SKILL.md" />)
  expect(await view.findByRole("alert")).toHaveTextContent("File unavailable")
  failed = false
  fireEvent.click(view.getByRole("button", { name: "Retry" }))
  expect(await view.findByRole("heading", { name: "Instructions" })).toBeVisible()
  await waitFor(() => expect(view.queryByText("hidden-metadata")).toBeNull())
  expect(view.getByText("evidence").tagName).toBe("STRONG")
})
