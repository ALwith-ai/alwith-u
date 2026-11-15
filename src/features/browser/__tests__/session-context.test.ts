import { beforeEach, expect, test, vi } from "vitest"
const { invoke, capabilities } = vi.hoisted(() => ({ invoke: vi.fn(), capabilities: vi.fn() }))
vi.mock("@/lib/runtime-capabilities", () => ({ runtimeCapabilities: capabilities }))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
import { browserSessionContext } from "../session-context"
beforeEach(() => {
  invoke.mockReset()
  capabilities.mockResolvedValue({ backend: "cef", embeddedBrowser: true })
})
test("attaches the bundled MCP server and binds the exact conversation", async () => {
  invoke
    .mockResolvedValueOnce({ token: "opaque", command: "/app/bun", args: ["/app/browser.mjs"], env: [] })
    .mockResolvedValue(undefined)
  const context = await browserSessionContext()
  expect(context.mcpServers).toEqual([
    { type: "stdio", name: "embedded_browser", command: "/app/bun", args: ["/app/browser.mjs"], env: [] }
  ])
  await context.bind!("conversation-b")
  expect(invoke).toHaveBeenLastCalledWith("cef_browser_bind", { token: "opaque", sessionId: "conversation-b" })
})
test("does not advertise a browser tool connection when its native descriptor fails", async () => {
  invoke.mockRejectedValueOnce(new Error("Bundled browser MCP entry is missing"))
  await expect(browserSessionContext()).rejects.toThrow("Bundled browser MCP entry is missing")
})

test("Wry does not request or advertise CEF browser tools", async () => {
  capabilities.mockResolvedValue({ backend: "wry", embeddedBrowser: false })
  const context = await browserSessionContext()
  expect(context.mcpServers).toEqual([])
  expect(context.bind).toBeUndefined()
  expect(invoke).not.toHaveBeenCalled()
})
