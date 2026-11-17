import { invoke } from "@tauri-apps/api/core"
import { afterEach, expect, test, vi } from "vitest"

import { client } from "@/lib/client"

import { prepareBrowserChat } from "../quick-chat-session"
import { useBrowserQuickChat } from "../quick-chat-state"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }))
vi.mock("@/lib/providers", () => ({ applyProvidersWhenIdle: vi.fn(async () => {}) }))
vi.mock("@/lib/client", () => ({
  client: {
    connect: vi.fn(async () => {}),
    stopSession: vi.fn(async () => {}),
    open: vi.fn(async () => {}),
    refreshProjectContext: vi.fn(async () => ({ chatDirectory: "/quick-chats" })),
    newSession: vi.fn(async () => "new"),
    session: vi.fn(() => ({ cwd: "/quick-chats" }))
  }
}))
const original = useBrowserQuickChat.getState()
afterEach(() => {
  useBrowserQuickChat.setState(original, true)
  vi.clearAllMocks()
})

test("restoration uses the explicit browser conversation without taking main's draft slot", async () => {
  useBrowserQuickChat.setState({ sessionId: "browser", cwd: "/quick-chats" })
  await prepareBrowserChat()
  expect(client.open).toHaveBeenCalledExactlyOnceWith("browser", "/quick-chats", {})
  expect(client.newSession).not.toHaveBeenCalled()
  expect(invoke).toHaveBeenLastCalledWith("cef_browser_quick_chat", { sessionId: "browser" })
})
test("new chat waits for the old Runtime session to stop before replacing and granting access", async () => {
  useBrowserQuickChat.setState({ sessionId: "old", cwd: "/quick-chats" })
  let finish = () => {}
  vi.mocked(client.stopSession).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const operation = prepareBrowserChat(true)
  await vi.waitFor(() => expect(client.stopSession).toHaveBeenCalledWith("old"))
  expect(client.newSession).not.toHaveBeenCalled()
  expect(useBrowserQuickChat.getState().sessionId).toBe("old")
  expect(prepareBrowserChat(true)).toBe(operation)
  finish()
  await operation
  expect(client.newSession).toHaveBeenCalledExactlyOnceWith("/quick-chats", { meta: { alwith: { inputMode: "chat" } } })
  expect(useBrowserQuickChat.getState().sessionId).toBe("new")
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ["cef_browser_quick_chat", { sessionId: null }],
    ["cef_browser_quick_chat", { sessionId: "new" }]
  ])
})
test("a failed stop leaves the old association and never creates a replacement", async () => {
  useBrowserQuickChat.setState({ sessionId: "old", cwd: "/quick-chats" })
  vi.mocked(client.stopSession).mockRejectedValueOnce(Error("Stop failed"))
  await expect(prepareBrowserChat(true)).rejects.toThrow("Stop failed")
  expect(useBrowserQuickChat.getState().sessionId).toBe("old")
  expect(client.newSession).not.toHaveBeenCalled()
  expect(invoke).not.toHaveBeenCalled()
})
