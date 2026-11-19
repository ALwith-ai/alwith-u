import "./language"
import { type DesktopCanvas, DesktopCanvasContext } from "@alwith/module-desktop-shell/react"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { expect, test, vi } from "vitest"

import { BrowserWorkspace } from "../browser-workspace"
vi.mock("../browser-quick-chat", () => ({ BrowserQuickChat: () => null }))
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }) }))
vi.mock("../browser-pane", () => ({
  BrowserPane: ({ request, active }: { request?: { url: string }; active: boolean }) => (
    <div data-active={active}>
      <input aria-label={request?.url ?? "manual draft"} />
    </div>
  )
}))
const props = { active: true, maximized: false, onMaximize: vi.fn(), onClose: vi.fn() }

test("revealing an open browser returns to its canvas region without recreating its page", () => {
  const navigate = vi.fn()
  const canvas: DesktopCanvas = {
    viewportWidth: 1256,
    budget: 1000,
    region: "preview",
    trailingActive: false,
    moving: false,
    movePane: vi.fn(() => false),
    navigate
  }
  const surface = (revealRequest: number, region = "preview", active = true) => (
    <DesktopCanvasContext.Provider value={{ ...canvas, region }}>
      <BrowserWorkspace {...props} active={active} revealRequest={revealRequest} />
    </DesktopCanvasContext.Provider>
  )
  const view = render(surface(1))
  expect(navigate).toHaveBeenLastCalledWith("browser")
  const draft = screen.getByRole("textbox", { name: "manual draft" })
  fireEvent.change(draft, { target: { value: "retained page" } })
  navigate.mockClear()
  view.rerender(surface(1, "preview"))
  expect(navigate).not.toHaveBeenCalled()
  view.rerender(surface(2))
  expect(navigate).toHaveBeenCalledExactlyOnceWith("browser")
  expect(screen.getByRole("textbox", { name: "manual draft" })).toBe(draft)
  expect(draft).toHaveValue("retained page")
  navigate.mockClear()
  view.rerender(surface(3, "preview", false))
  expect(navigate).not.toHaveBeenCalled()
  view.rerender(surface(3))
  expect(navigate).toHaveBeenCalledExactlyOnceWith("browser")
})
test("different AI requests create independent retained tabs", async () => {
  const a = { id: "a", url: "https://first.example/", sessionId: "ai-a" }
  const b = { id: "b", url: "https://second.example/", sessionId: "ai-b" }
  const sessionTitles = { "ai-a": "检查项目", "ai-b": "整理邮件" }
  const view = render(<BrowserWorkspace {...props} request={a} sessionTitles={sessionTitles} />)
  const input = screen.getByLabelText(a.url)
  fireEvent.change(input, { target: { value: "retained" } })
  view.rerender(<BrowserWorkspace {...props} request={b} sessionTitles={sessionTitles} />)
  await screen.findByRole("tab", { name: /second.example/ })
  expect(screen.getByRole("button", { name: "标签组 检查项目" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "标签组 整理邮件" })).toBeInTheDocument()
  expect(input).toHaveValue("retained")
  expect(input.closest('[aria-hidden="true"]')).not.toBeNull()
  fireEvent.mouseDown(screen.getByRole("tab", { name: /first.example/ }))
  fireEvent.click(screen.getByRole("tab", { name: /first.example/ }))
  await waitFor(() => expect(input.closest('[aria-hidden="true"]')).toBeNull())
  fireEvent.click(screen.getByRole("button", { name: "关闭标签 second.example" }))
  expect(screen.queryByLabelText(b.url)).toBeNull()
  expect(input).toHaveValue("retained")
})
test("ordinary browsing opens a new tab without a project or AI session", () => {
  render(<BrowserWorkspace {...props} />)
  fireEvent.click(screen.getByRole("button", { name: "新建网页标签" }))
  expect(screen.getAllByRole("tab")).toHaveLength(2)
  expect(screen.queryByLabelText("AI 会话标签")).toBeNull()
})

test("pane controls stay in the tab header as tabs are opened and the workspace expands", () => {
  const onMaximize = vi.fn()
  const onClose = vi.fn()
  const view = render(<BrowserWorkspace {...props} onMaximize={onMaximize} onClose={onClose} />)
  const tabList = screen.getByRole("tablist")
  const header = tabList.closest("header")!
  const expand = within(header).getByRole("button", { name: "展开网页" })
  const close = within(header).getByRole("button", { name: "收起网页" })
  fireEvent.click(within(header).getByRole("button", { name: "新建网页标签" }))
  expect(tabList).not.toContainElement(expand)
  expect(tabList).not.toContainElement(close)
  fireEvent.click(expand)
  expect(onMaximize).toHaveBeenCalledOnce()
  view.rerender(<BrowserWorkspace {...props} maximized onMaximize={onMaximize} onClose={onClose} />)
  expect(within(header).getByRole("button", { name: "并排显示网页" })).toBe(expand)
  fireEvent.click(close)
  expect(onClose).toHaveBeenCalledOnce()
})

test("only the tab list scrolls on overflow and selecting a clipped tab reveals it", () => {
  render(<BrowserWorkspace {...props} />)
  const list = screen.getByRole("tablist")
  Object.defineProperties(list, {
    clientWidth: { value: 220 },
    scrollWidth: { value: 440, configurable: true }
  })
  fireEvent.wheel(list, { deltaX: 60 })
  fireEvent.wheel(list, { deltaY: 40 })
  fireEvent.wheel(list, { deltaY: 40, ctrlKey: true })
  expect(list.scrollLeft).toBe(100)
  fireEvent.wheel(list.closest("header")!, { deltaY: 40 })
  expect(list.scrollLeft).toBe(100)

  const first = within(list).getByRole("tab")
  Object.defineProperties(first, { offsetLeft: { value: 0 }, offsetWidth: { value: 96 } })
  fireEvent.click(screen.getByRole("button", { name: "新建网页标签" }))
  fireEvent.mouseDown(first)
  fireEvent.click(first)
  expect(first).toHaveAttribute("aria-selected", "true")
  expect(list.scrollLeft).toBe(0)
  Object.defineProperty(list, "scrollWidth", { value: 220 })
  fireEvent.wheel(list, { deltaY: 40 })
  expect(list.scrollLeft).toBe(0)
})

test("a group identifies its tabs and reveals its chip with the selected first tab", async () => {
  const request = { id: "grouped", url: "https://grouped.example", sessionId: "ai-group" }
  render(<BrowserWorkspace {...props} request={request} sessionTitles={{ "ai-group": "项目资料" }} />)
  const list = screen.getByRole("tablist")
  const chip = within(list).getByRole("button", { name: "标签组 项目资料" })
  const grouped = within(list).getByRole("tab", { name: /grouped.example/ })
  expect(grouped).toHaveAccessibleDescription("标签组 项目资料")
  fireEvent.click(screen.getByRole("button", { name: "新建网页标签" }))
  Object.defineProperty(list, "clientWidth", { value: 220 })
  Object.defineProperty(chip, "offsetLeft", { value: 8 })
  Object.defineProperties(grouped, { offsetLeft: { value: 96 }, offsetWidth: { value: 96 } })
  list.scrollLeft = 90
  fireEvent.mouseDown(grouped)
  fireEvent.click(grouped)
  await waitFor(() => expect(grouped).toHaveAttribute("aria-selected", "true"))
  expect(list.scrollLeft).toBe(8)

  fireEvent.click(chip)
  expect(chip).toHaveAttribute("aria-expanded", "false")
  expect(within(list).getAllByRole("tab")).toHaveLength(1)
  fireEvent.click(chip)
  expect(chip).toHaveAttribute("aria-expanded", "true")
  expect(within(list).getAllByRole("tab")).toHaveLength(2)
})

test("batched closes never restore a removed tab or lose the active tab", async () => {
  const a = { id: "a", url: "https://a.example" }
  const b = { id: "b", url: "https://b.example" }
  const c = { id: "c", url: "https://c.example" }
  const view = render(<BrowserWorkspace {...props} request={a} />)
  view.rerender(<BrowserWorkspace {...props} request={b} />)
  await screen.findByRole("tab", { name: "b.example" })
  view.rerender(<BrowserWorkspace {...props} request={c} />)
  await screen.findByRole("tab", { name: "c.example" })
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "关闭标签 a.example" }))
    fireEvent.click(screen.getByRole("button", { name: "关闭标签 b.example" }))
  })
  expect(screen.getAllByRole("tab")).toHaveLength(1)
  expect(screen.getByRole("tab", { name: "c.example" })).toHaveAttribute("aria-selected", "true")
})
