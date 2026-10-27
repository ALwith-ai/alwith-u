import { invoke } from "@tauri-apps/api/core"
import * as dialog from "@tauri-apps/plugin-dialog"
import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { DraftProjectPicker } from "../draft-project-picker"

// Package exports are frozen ESM namespaces; mock the module so the export can be spied on.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/plugin-dialog", async (importOriginal) => ({ ...(await importOriginal<object>()), open: vi.fn() }))

await initI18n("en")
beforeEach(() => vi.mocked(invoke).mockResolvedValue("/Users/mac/Documents/ALwith"))
afterEach(() => vi.clearAllMocks())

test("project preparation keeps the folder and hover-clear icons without a spinner", async () => {
  const onChange = vi.fn()
  const view = render(<DraftProjectPicker cwd="/tmp/current" recentProjects={[]} onChange={onChange} preparing />)
  const picker = view.container.querySelector(".chat-project-picker")
  expect(picker).toHaveAttribute("aria-busy", "true")
  expect(picker?.querySelector(".lucide-loader-circle")).toBeNull()
  expect(picker?.querySelector(".lucide-folder-closed")).toBeVisible()
  expect(picker?.querySelector(".lucide-x")).not.toBeNull()
  await waitFor(() => expect(view.getByRole("button", { name: "Work outside a project" })).toBeEnabled())
  expect(view.getByRole("button", { name: "current" })).toBeEnabled()
  view.rerender(<DraftProjectPicker cwd="/tmp/current" recentProjects={[]} onChange={onChange} />)
  expect(picker).toHaveAttribute("aria-busy", "false")
  expect(picker?.querySelector(".lucide-loader-circle")).toBeNull()
  expect(picker?.querySelector(".lucide-folder-closed")).toBeVisible()
  view.rerender(<DraftProjectPicker cwd={null} recentProjects={[]} onChange={onChange} preparing />)
  expect(picker?.querySelector(".lucide-loader-circle")).toBeNull()
  expect(picker?.querySelector(".lucide-folder-closed")).toBeVisible()
  expect(onChange).not.toHaveBeenCalled()
})

test("project picker pins the current directory once, marks it selected and reports a new choice", async () => {
  const chosen: string[] = []
  const view = render(
    <DraftProjectPicker
      cwd="/tmp/current"
      recentProjects={["/tmp/recent", "/tmp/current"]}
      onChange={(cwd) => chosen.push(cwd)}
    />
  )
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "current" }))))
  const projects = view.getAllByRole("menuitemradio")
  expect(projects).toHaveLength(2)
  expect(projects[0]?.textContent).toBe("current")
  expect(projects[0]?.getAttribute("aria-checked")).toBe("true")
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("menuitemradio", { name: "recent" }))))
  expect(chosen).toEqual(["/tmp/recent"])
  await waitFor(() => expect(view.queryByRole("menu")).toBeNull())
})

test("canceling the directory dialog keeps a draft without a project", async () => {
  const open = vi.spyOn(dialog, "open").mockResolvedValue(null)
  const chosen: string[] = []
  try {
    const view = render(<DraftProjectPicker cwd={null} recentProjects={[]} onChange={(cwd) => chosen.push(cwd)} />)
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Select project" }))))
    expect(view.queryAllByRole("menuitemradio")).toHaveLength(0)
    expect(view.getAllByRole("menuitem")).toHaveLength(1)
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("menuitem"))))
    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false, defaultPath: undefined })
    expect(chosen).toEqual([])
  } finally {
    open.mockRestore()
  }
})

test("outside-project selection resolves to the host default and hides it from recent projects", async () => {
  const onChange = vi.fn()
  const view = render(
    <DraftProjectPicker
      cwd="/tmp/current"
      recentProjects={["/Users/mac/Documents/ALwith", "/tmp/recent"]}
      onChange={onChange}
    />
  )
  await act(async () => {})
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "current" }))))
  expect(view.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual(["current", "recent"])
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("menuitem", { name: "Work outside a project" }))))
  expect(onChange).toHaveBeenCalledWith("/Users/mac/Documents/ALwith")
  expect(invoke).toHaveBeenCalledWith("draft_directory", { cwd: null })
  view.rerender(
    <DraftProjectPicker
      cwd="/Users/mac/Documents/ALwith"
      recentProjects={["/Users/mac/Documents/ALwith"]}
      onChange={onChange}
    />
  )
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Select project" }))))
  expect(view.queryAllByRole("menuitemradio")).toHaveLength(0)
  expect(view.queryByRole("menuitem", { name: "Work outside a project" })).toBeNull()
})

test("the project icon exits directly without opening the project menu", async () => {
  const onChange = vi.fn()
  const view = render(<DraftProjectPicker cwd="/tmp/current" recentProjects={[]} onChange={onChange} />)
  const clear = view.getByRole("button", { name: "Work outside a project" })
  await waitFor(() => expect(clear).toBeEnabled())
  fireEvent.click(clear)
  expect(onChange).toHaveBeenCalledExactlyOnceWith("/Users/mac/Documents/ALwith")
  expect(view.queryByRole("menu")).toBeNull()
  expect(view.container.querySelector("button button")).toBeNull()
  view.rerender(<DraftProjectPicker cwd="/Users/mac/Documents/ALwith" recentProjects={[]} onChange={onChange} />)
  expect(view.queryByRole("button", { name: "Work outside a project" })).toBeNull()
  expect(view.getByRole("button", { name: "Select project" })).toBeVisible()
})

test("the project icon waits for the host default before allowing an exit", async () => {
  const directory = Promise.withResolvers<string>()
  vi.mocked(invoke).mockReturnValue(directory.promise)
  const onChange = vi.fn()
  const view = render(<DraftProjectPicker cwd="/tmp/current" recentProjects={[]} onChange={onChange} />)
  const clear = view.getByRole("button", { name: "Work outside a project" })
  expect(clear).toBeDisabled()
  fireEvent.click(clear)
  expect(onChange).not.toHaveBeenCalled()
  await act(() => Promise.resolve(directory.resolve("/Users/mac/Documents/ALwith")))
  expect(clear).toBeEnabled()
  fireEvent.click(clear)
  expect(onChange).toHaveBeenCalledExactlyOnceWith("/Users/mac/Documents/ALwith")
})

test("project choices exclude quick-chat directories but retain temporary workspaces", async () => {
  const onChange = vi.fn()
  const view = render(
    <DraftProjectPicker
      cwd="/private/var/folders/example/T/current"
      recentProjects={[
        "/Users/mac/Documents/Codex/project",
        "/Users/mac/Documents/ALwith",
        "/var/folders/example/T/project",
        String.raw`C:\Users\Alice\Documents\Codex\project`,
        String.raw`C:\Users\Alice\AppData\Local\Temp\project`,
        String.raw`C:\Windows\Temp\project`,
        String.raw`D:\Scratch\project`,
        "/work/recent",
        "/Users/mac/Documents/ALwith U",
        "/Users/mac/Documents/ALwith/real-project",
        "/var/folders-other/ordinary"
      ]}
      onChange={onChange}
    />
  )
  try {
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "current" }))))
    expect(view.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual([
      "current",
      "project",
      "project",
      "project",
      "project",
      "recent",
      "ALwith U",
      "real-project",
      "ordinary"
    ])
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("menuitemradio", { name: "recent" }))))
    expect(onChange.mock.calls[0]?.[0]).toBe("/work/recent")
  } finally {
    view.unmount()
  }
})
