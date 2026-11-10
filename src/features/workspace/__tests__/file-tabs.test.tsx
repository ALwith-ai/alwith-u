import { createEditorController } from "@alwith/module-editor"
import { createFileTabs } from "@alwith/module-editor/tabs/core"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { expect, test, vi } from "vitest"

import { displayShortcut } from "@/lib/shortcut-formatter"

import { FileTabs } from "../file-tabs"

const labels = {
  newTab: "New tab",
  close: "Close",
  closeOthers: "Close others",
  closeRight: "Close to the right",
  closeSaved: "Close saved",
  closeAll: "Close all",
  copyPath: "Copy path",
  reveal: "Reveal"
}

async function setup() {
  const onError = vi.fn()
  const fs = createFileSystem({
    adapter: createMemoryAdapter({ "/a.txt": "a", "/b.txt": "b", "/c.txt": "c" }),
    reportError: onError
  })
  const editor = createEditorController({ fs, reportError: onError, confirmClose: () => Promise.resolve("cancel") })
  const tabs = createFileTabs(editor)
  await tabs.openFile("/a.txt", true)
  await tabs.openFile("/b.txt", true)
  await tabs.openFile("/c.txt", true)
  render(<FileTabs workspace={tabs} editor={editor} labels={labels} prefix="files" onError={onError} />)
  return { tabs, editor, onError }
}

test("close buttons are accessible siblings of file activators", async () => {
  const { tabs } = await setup()
  expect(screen.getByRole("tab", { name: "b.txt" })).not.toContainElement(
    screen.getByRole("button", { name: "Close b.txt" })
  )
  fireEvent.click(screen.getByRole("button", { name: "Close b.txt" }))
  await waitFor(() => expect(screen.queryByRole("tab", { name: "b.txt" })).toBeNull())
  expect(tabs.serialize().tabs).toHaveLength(2)
})

test("the new tab action exposes the shared tooltip with a keyboard badge", async () => {
  await setup()
  const button = screen.getByRole("button", { name: "New tab" })
  expect(button).not.toHaveAttribute("title")
  await act(() => Promise.try(() => button.focus()))
  const tooltip = await screen.findByRole("tooltip")
  expect(tooltip).toHaveTextContent("New tab")
  expect(tooltip.querySelector("kbd")).toHaveTextContent(displayShortcut("CmdOrCtrl+T"))
  fireEvent.click(button)
  expect(screen.getByRole("tab", { name: "New tab" })).toHaveAttribute("aria-selected", "true")
})

test("keyboard navigation wraps, supports home and end, and preserves modified arrows", async () => {
  await setup()
  const first = screen.getByRole("tab", { name: "a.txt" })
  fireEvent.keyDown(first, { key: "End" })
  expect(screen.getByRole("tab", { name: "c.txt" })).toHaveAttribute("aria-selected", "true")
  fireEvent.keyDown(screen.getByRole("tab", { name: "c.txt" }), { key: "ArrowRight" })
  expect(first).toHaveAttribute("aria-selected", "true")
  fireEvent.keyDown(first, { key: "ArrowRight", ctrlKey: true })
  fireEvent.keyDown(first, { key: "ArrowRight", shiftKey: true })
  expect(first).toHaveAttribute("aria-selected", "true")
  fireEvent.keyDown(first, { key: "ArrowRight" })
  expect(screen.getByRole("tab", { name: "b.txt" })).toHaveAttribute("aria-selected", "true")
  fireEvent.keyDown(screen.getByRole("tab", { name: "b.txt" }), { key: "Home" })
  expect(first).toHaveAttribute("aria-selected", "true")
})

test("right-to-left navigation follows the visual direction", async () => {
  await setup()
  const first = screen.getByRole("tab", { name: "a.txt" })
  first.style.direction = "rtl"
  fireEvent.keyDown(first, { key: "ArrowLeft" })
  expect(screen.getByRole("tab", { name: "b.txt" })).toHaveAttribute("aria-selected", "true")
})

test("delete restores focus to the selected tab and closing the last tab focuses new", async () => {
  const { tabs } = await setup()
  fireEvent.keyDown(screen.getByRole("tab", { name: "c.txt" }), { key: "Delete" })
  await waitFor(() => expect(screen.getByRole("tab", { name: "b.txt" })).toHaveFocus())
  await act(() => tabs.requestCloseMany(tabs.getSnapshot().tabs.map((tab) => tab.id)))
  const blank = screen.getByRole("button", { name: "New tab" })
  fireEvent.click(blank)
  await waitFor(() => expect(screen.getByRole("tab", { name: "New tab" })).toHaveFocus())
  fireEvent.keyDown(screen.getByRole("tab", { name: "New tab" }), { key: "Delete" })
  await waitFor(() => expect(blank).toHaveFocus())
})

test("double click keeps the preview and middle click closes without activating the target", async () => {
  const { editor, tabs, onError } = await setup()
  await act(() => tabs.requestCloseMany(tabs.getSnapshot().tabs.map((tab) => tab.id)))
  await act(() => tabs.openFile("/a.txt"))
  fireEvent.doubleClick(screen.getByRole("tab", { name: "a.txt" }))
  expect(editor.getSnapshot().documents[0].pinned).toBe(true)
  await act(() => tabs.openFile("/b.txt", true))
  fireEvent(screen.getByRole("tab", { name: "a.txt" }), new MouseEvent("auxclick", { button: 1, bubbles: true }))
  await waitFor(() => expect(screen.queryByRole("tab", { name: "a.txt" })).toBeNull())
  expect(screen.getByRole("tab", { name: "b.txt" })).toHaveAttribute("aria-selected", "true")
  expect(onError).not.toHaveBeenCalled()
})
