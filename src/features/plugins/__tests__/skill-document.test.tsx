import * as core from "@tauri-apps/api/core"
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { skillDocuments } from "../request-cache"
import { readSkillDocument, SkillDocument, skillMarkdownBody } from "../skill-document"

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  invoke: vi.fn(),
  convertFileSrc: (token: string, protocol: string) => `${protocol}://localhost/${token}`
}))
/** The plugin gives the file an address; the page reads the file by fetching it. */
function serve(text: string): void {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(text)))
}

vi.mock("@/components/theme-provider", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }))

beforeEach(async () => {
  skillDocuments.clear()
  await initI18n("en")
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test("reads the actual skill file through the shared filesystem plugin", async () => {
  const invoke = vi.mocked(core.invoke).mockImplementation((command) => {
    if (command === "plugin:alwith-fs|workspace_open") return Promise.resolve("/skills/research")
    if (command === "plugin:alwith-fs|workspace_link") return Promise.resolve("token")
    if (command === "plugin:alwith-fs|workspace_unlink") return Promise.resolve(null)
    return Promise.reject(new Error("Unexpected command"))
  })
  // The file is read by fetching the address the plugin gave it, then the address is given back.
  const fetched = vi.fn((_url: string) => Promise.resolve(new Response("# Instructions\nUse evidence.")))
  vi.stubGlobal("fetch", fetched)
  expect(await readSkillDocument("/skills/research/SKILL.md")).toBe("# Instructions\nUse evidence.")
  expect(invoke).toHaveBeenCalledWith("plugin:alwith-fs|workspace_open", { path: "/skills/research" })
  expect(invoke).toHaveBeenCalledWith("plugin:alwith-fs|workspace_link", {
    root: "/skills/research",
    path: "/skills/research/SKILL.md"
  })
  expect(fetched.mock.calls[0]![0]).toContain("token/SKILL.md")
  expect(invoke).toHaveBeenCalledWith("plugin:alwith-fs|workspace_unlink", { token: "token" })
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
    if (command === "plugin:alwith-fs|workspace_open") return Promise.resolve("/skills")
    if (command === "plugin:alwith-fs|workspace_link") return Promise.resolve("token")
    return Promise.resolve(null)
  })
  serve("---\nname: hidden-metadata\n---\n# Instructions\n\nUse **evidence**.")
  const view = render(<SkillDocument path="/skills/SKILL.md" />)
  expect(await view.findByRole("alert")).toHaveTextContent("File unavailable")
  failed = false
  fireEvent.click(view.getByRole("button", { name: "Retry" }))
  expect(await view.findByRole("heading", { name: "Instructions" })).toBeVisible()
  await waitFor(() => expect(view.queryByText("hidden-metadata")).toBeNull())
  expect(view.getByText("evidence").tagName).toBe("STRONG")
})

test("reopening a skill uses the cached document and invalidation reloads its content", async () => {
  const invoke = vi.mocked(core.invoke).mockImplementation((command) => {
    if (command === "plugin:alwith-fs|workspace_open") return Promise.resolve("/skills/research")
    if (command === "plugin:alwith-fs|workspace_link") return Promise.resolve("token")
    return Promise.resolve(null)
  })
  serve("# Cached instructions")
  const view = render(<SkillDocument path="/skills/research/SKILL.md" />)
  expect(await view.findByRole("heading", { name: "Cached instructions" })).toBeVisible()
  view.unmount()
  const reopened = render(<SkillDocument path="/skills/research/SKILL.md" />)
  expect(reopened.getByRole("heading", { name: "Cached instructions" })).toBeVisible()
  expect(invoke).toHaveBeenCalledTimes(3)
  reopened.unmount()
  skillDocuments.clear()
  await readSkillDocument("/skills/research/SKILL.md")
  expect(invoke).toHaveBeenCalledTimes(6)
})
