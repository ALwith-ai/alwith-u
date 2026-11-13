import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { projectContext } from "@/agent/__tests__/project-context"
import type { AppState } from "@/agent/client"
import { initI18n } from "@/lib/i18n"

import { ChatWelcome } from "../chat-welcome"

const state = vi.hoisted(() => ({ mode: "chat", openPath: vi.fn().mockResolvedValue(undefined) }))
let context: AppState["projectContext"] = projectContext()
vi.mock("../composer/input-mode", () => ({ useInputMode: () => ({ mode: state.mode }) }))
vi.mock("@/lib/client", () => ({
  useApp: (select: (value: Pick<AppState, "projectContext">) => unknown) => select({ projectContext: context })
}))
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: state.openPath }))

afterEach(() => {
  cleanup()
  state.openPath.mockClear()
  context = projectContext()
})

await initI18n("en")

test.each(["chat", "image"])("%s welcome shows the project path in a tooltip and opens its folder", async (mode) => {
  state.mode = mode
  const project = "/tmp/work/my-project"
  const view = render(<ChatWelcome cwd={project} />)
  const name = view.getByRole("button", { name: "Open project folder: my-project" })
  expect(name).toHaveTextContent("my-project")
  expect(name).not.toHaveAttribute("title")
  await act(() => name.focus())
  const tooltip = await view.findByText(project)
  expect(tooltip).toHaveAttribute("data-slot", "tooltip-content")
  expect(tooltip).toBeVisible()
  fireEvent.click(name)
  expect(state.openPath).toHaveBeenCalledWith(project)
})

test("welcome without a project has no project tooltip trigger", () => {
  state.mode = "chat"
  const view = render(<ChatWelcome />)
  expect(view.queryByRole("button")).toBeNull()
  expect(view.queryByRole("tooltip")).toBeNull()
})

test.each(["chat", "image"])("%s welcome excludes the default directory even inside a registered project", (mode) => {
  state.mode = mode
  const current = projectContext()
  context = {
    ...current,
    projects: [
      {
        id: "alwith",
        name: "ALwith",
        roots: [{ path: current.chatDirectory }],
        metadata: {},
        position: 0,
        createdAt: 0,
        updatedAt: 0,
        recencyAt: null
      }
    ]
  }
  const view = render(<ChatWelcome cwd={current.chatDirectory} />)
  expect(
    view.getByText(mode === "chat" ? "What would you like to talk about?" : "What would you like to create?")
  ).toBeVisible()
  expect(view.queryByRole("button")).toBeNull()
})

test("welcome waits for project context and updates when a project is cleared", () => {
  state.mode = "chat"
  context = null
  const view = render(<ChatWelcome cwd="/tmp/my-project" />)
  expect(view.queryByRole("button")).toBeNull()
  context = projectContext()
  view.rerender(<ChatWelcome cwd="/tmp/my-project" />)
  expect(view.getByRole("button", { name: "Open project folder: my-project" })).toBeVisible()
  view.rerender(<ChatWelcome cwd={null} />)
  expect(view.queryByRole("button")).toBeNull()
})
