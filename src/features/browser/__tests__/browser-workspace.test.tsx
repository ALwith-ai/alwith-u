import "./language"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { expect, test, vi } from "vitest"

import { BrowserWorkspace } from "../browser-workspace"
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }) }))
vi.mock("../browser-pane", () => ({
  BrowserPane: ({ request, active }: { request?: { url: string }; active: boolean }) => (
    <div data-active={active}>
      <input aria-label={request?.url ?? "manual draft"} />
    </div>
  )
}))
const props = { active: true, maximized: false, onMaximize: vi.fn(), onClose: vi.fn() }
test("different AI requests create independent retained tabs", async () => {
  const a = { id: "a", url: "https://first.example/", sessionId: "ai-a" }
  const b = { id: "b", url: "https://second.example/", sessionId: "ai-b" }
  const view = render(<BrowserWorkspace {...props} request={a} />)
  const input = screen.getByLabelText(a.url)
  fireEvent.change(input, { target: { value: "retained" } })
  view.rerender(<BrowserWorkspace {...props} request={b} />)
  await screen.findByRole("tab", { name: /second.example/ })
  expect(input).toHaveValue("retained")
  expect(input.closest("[hidden]")).not.toBeNull()
  fireEvent.mouseDown(screen.getByRole("tab", { name: /first.example/ }))
  fireEvent.click(screen.getByRole("tab", { name: /first.example/ }))
  await waitFor(() => expect(input.closest("[hidden]")).toBeNull())
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
