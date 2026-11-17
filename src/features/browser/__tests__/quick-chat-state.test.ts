import { afterEach, expect, test, vi } from "vitest"

const key = "browser.quickChat.v1"
afterEach(() => {
  localStorage.removeItem(key)
  vi.resetModules()
})

test("cold startup restores placement but never restores a conversation association", async () => {
  localStorage.setItem(
    key,
    JSON.stringify({
      sessionId: "previous-conversation",
      cwd: "/previous",
      expanded: true,
      side: "left",
      edge: "top",
      size: { width: 500, height: 600 }
    })
  )
  vi.resetModules()
  const { useBrowserQuickChat } = await import("../quick-chat-state")
  expect(useBrowserQuickChat.getState()).toMatchObject({
    sessionId: null,
    cwd: null,
    expanded: false,
    side: "left",
    edge: "top",
    size: { width: 500, height: 600 }
  })
  useBrowserQuickChat.setState({ sessionId: "new-conversation", cwd: "/new" })
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
    side: "left",
    edge: "top",
    size: { width: 500, height: 600 }
  })
})

test("legacy placement without a vertical anchor keeps its bottom dock", async () => {
  localStorage.setItem(
    key,
    JSON.stringify({
      sessionId: "previous-conversation",
      cwd: "/previous",
      expanded: false,
      side: "right",
      size: { width: 560, height: 640 }
    })
  )
  vi.resetModules()
  const { useBrowserQuickChat } = await import("../quick-chat-state")
  expect(useBrowserQuickChat.getState()).toMatchObject({ sessionId: null, cwd: null, edge: "bottom" })
})
