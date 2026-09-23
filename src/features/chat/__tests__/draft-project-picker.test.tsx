import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { expect, spyOn, test } from "bun:test"
import * as dialog from "@tauri-apps/plugin-dialog"
import { initI18n } from "@/lib/i18n"
import { DraftProjectPicker } from "../draft-project-picker"
import { installDom } from "../codex/__tests__/dom-environment"

installDom()
await initI18n("en")

test("project picker pins the current directory once, marks it selected and reports a new choice", async () => {
  const chosen: string[] = []
  const view = render(
    <DraftProjectPicker
      cwd="/tmp/current"
      recentProjects={["/tmp/recent", "/tmp/current"]}
      onChange={cwd => chosen.push(cwd)}
    />
  )
  await act(async () => fireEvent.click(view.getByRole("button", { name: "current" })))
  const projects = view.getAllByRole("menuitemradio")
  expect(projects).toHaveLength(2)
  expect(projects[0]?.textContent).toBe("current")
  expect(projects[0]?.getAttribute("aria-checked")).toBe("true")
  await act(async () => fireEvent.click(view.getByRole("menuitemradio", { name: "recent" })))
  expect(chosen).toEqual(["/tmp/recent"])
  await waitFor(() => expect(view.queryByRole("menu")).toBeNull())
})

test("canceling the directory dialog keeps a draft without a project", async () => {
  const open = spyOn(dialog, "open").mockResolvedValue(null)
  const chosen: string[] = []
  try {
    const view = render(<DraftProjectPicker cwd={null} recentProjects={[]} onChange={cwd => chosen.push(cwd)} />)
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Select project" })))
    expect(view.queryAllByRole("menuitemradio")).toHaveLength(0)
    expect(view.getAllByRole("menuitem")).toHaveLength(1)
    await act(async () => fireEvent.click(view.getByRole("menuitem")))
    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false, defaultPath: undefined })
    expect(chosen).toEqual([])
  } finally {
    open.mockRestore()
  }
})
