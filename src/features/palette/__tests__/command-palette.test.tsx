import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, expect, test } from "vitest"

import type { SessionSummary } from "@/agent/client"
import { ThemeProvider } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { CommandPalette } from "../command-palette"

await initI18n("en")

const originalState = client.state
afterEach(() => {
  cleanup()
  client.store.setState(originalState, true)
})

test("search opens with its command context and closes after selecting the explicit session", async () => {
  const sessionRow: SessionSummary = {
    sessionId: "sidebar-search-result",
    cwd: "/tmp/sidebar-project",
    title: "Floating layout review",
    updatedAt: null,
    archived: false
  }
  client.store.setState({ sessionList: [sessionRow] })
  const selected: SessionSummary[] = []
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <ThemeProvider>
        <Button onClick={() => setOpen(true)}>Search</Button>
        <CommandPalette
          open={open}
          onOpenChange={setOpen}
          onNewChat={() => {}}
          onOpenSettings={() => {}}
          onOpenPlugins={() => {}}
          onOpenHotkeys={() => {}}
          onOpenExtension={() => {}}
          onSelect={(value) => selected.push(value)}
        />
      </ThemeProvider>
    )
  }
  const view = render(<Harness />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Search" }))))
  expect(view.getByRole("combobox")).toBeTruthy()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("option", { name: /Floating layout review/ }))))
  expect(selected).toEqual([sessionRow])
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
})

function catalog(count: number): SessionSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    sessionId: `thread-${index}`,
    cwd: `/tmp/project-${index}`,
    title: `Session ${String(index).padStart(4, "0")}`,
    updatedAt: null,
    archived: false
  }))
}

function openPalette(sessionList: SessionSummary[]) {
  client.store.setState({ sessionList })
  const selected: SessionSummary[] = []
  function Harness() {
    const [open, setOpen] = useState(true)
    return (
      <ThemeProvider>
        <Button onClick={() => setOpen(true)}>Reopen</Button>
        <CommandPalette
          open={open}
          onOpenChange={setOpen}
          onNewChat={() => {}}
          onOpenSettings={() => {}}
          onOpenPlugins={() => {}}
          onOpenHotkeys={() => {}}
          onOpenExtension={() => {}}
          onSelect={(sessionRow) => selected.push(sessionRow)}
        />
      </ThemeProvider>
    )
  }
  return { view: render(<Harness />), selected }
}

test("bounds mounted results while searching titles, directories and IDs throughout a large catalog", async () => {
  const sessionRows = catalog(5_000)
  sessionRows[4_999] = { ...sessionRows[4_999], title: "远处的唯一目标" }
  const { view, selected } = openPalette(sessionRows)
  expect(view.getAllByRole("option").length).toBeLessThanOrEqual(21)
  const input = view.getByRole("combobox")
  for (const query of ["远处的唯一目标", "project-4999", "thread-4999"]) {
    fireEvent.change(input, { target: { value: query } })
    await waitFor(() => expect(view.getByRole("option", { name: /远处的唯一目标/ })).toBeDefined())
    expect(view.getAllByRole("option").length).toBeLessThanOrEqual(21)
  }
  fireEvent.click(view.getByRole("option", { name: /远处的唯一目标/ }))
  expect(selected).toEqual([sessionRows[4_999]])
})

test.each([{ key: "ArrowDown" }, { key: "n", ctrlKey: true }, { key: "j", ctrlKey: true }])(
  "keyboard navigation %o crosses a page and Enter opens the selected session",
  async (navigation) => {
    const sessionRows = catalog(100)
    const { view, selected } = openPalette(sessionRows)
    const input = view.getByRole("combobox")
    fireEvent.change(input, { target: { value: "Session" } })
    const rows = () =>
      view.getAllByRole("option").filter((row) => row.getAttribute("data-value")?.startsWith("session:"))
    expect(rows()).toHaveLength(20)
    const nextId = "session:thread-20"
    fireEvent.pointerMove(rows()[19])
    fireEvent.keyDown(input, { key: "ArrowDown", isComposing: true })
    expect(rows()).toHaveLength(20)
    fireEvent.keyDown(input, navigation)
    await waitFor(() => expect(document.querySelector('[data-value="session:thread-20"]')).not.toBeNull())
    const current = document.querySelector('[role="option"][aria-selected="true"]')
    expect(current?.getAttribute("data-value")).toBe(nextId)
    await waitFor(() => expect(input.getAttribute("aria-activedescendant")).toBe(current?.id))
    fireEvent.keyDown(input, { key: "Enter" })
    expect(selected).toEqual([sessionRows[20]])
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
    fireEvent.click(view.getByRole("button", { name: "Reopen" }))
    expect(view.getByRole("combobox")).toHaveValue("")
    expect(view.getAllByRole("option").length).toBeLessThanOrEqual(21)
  }
)

test("scrolling loads further results and a new search resets the page", () => {
  return Promise.try(() => {
    const { view } = openPalette(catalog(100))
    const input = view.getByRole("combobox")
    fireEvent.change(input, { target: { value: "Session" } })
    const list = view.getByRole("listbox")
    Object.defineProperties(list, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } })
    list.scrollTop = 780
    fireEvent.scroll(list)
    expect(view.getAllByRole("option")).toHaveLength(40)
    fireEvent.change(input, { target: { value: "Session 0" } })
    expect(view.getAllByRole("option")).toHaveLength(20)
    expect(list.scrollTop).toBe(0)
  })
})

test("the more-results button loads a page without submitting the highlighted session", () => {
  const { view, selected } = openPalette(catalog(100))
  fireEvent.change(view.getByRole("combobox"), { target: { value: "Session" } })
  const more = view.getByRole("button", { name: /Show more results/ })
  fireEvent.keyDown(more, { key: "Enter" })
  expect(selected).toEqual([])
  fireEvent.click(more)
  expect(view.getAllByRole("option")).toHaveLength(40)
  expect(view.getByRole("dialog")).toBeDefined()
  expect(selected).toEqual([])
})
