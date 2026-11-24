import { beforeEach, expect, test, vi } from "vitest"
const { capabilities } = vi.hoisted(() => ({ capabilities: vi.fn() }))
vi.mock("@/lib/runtime-capabilities", () => ({ runtimeCapabilities: capabilities }))
import { browserSessionContext } from "../session-context"
beforeEach(() => capabilities.mockResolvedValue({ backend: "cef", embeddedBrowser: true }))
test("browser instructions use application tools without launching an MCP server", async () => {
  const context = await browserSessionContext()
  expect(context.mcpServers).toEqual([])
  expect(context.appendSystemPrompt).toContain("browser_* application tools")
  expect(context.appendSystemPrompt).toContain("When verifying a local webpage, prefer U's built-in CEF browser")
  expect(context.bind).toBeUndefined()
})
test("Wry does not advertise embedded browser capabilities", async () => {
  capabilities.mockResolvedValue({ backend: "wry", embeddedBrowser: false })
  const context = await browserSessionContext()
  expect(context.mcpServers).toEqual([])
  expect(context.appendSystemPrompt).toBeUndefined()
})
