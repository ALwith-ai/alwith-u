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
  // What the user pointed at is acted on directly, and a document is edited one piece at a time.
  expect(context.appendSystemPrompt).toContain("That tab and selector are current")
  expect(context.appendSystemPrompt).toContain("Never use browser_type with replace=true on a document")
  expect(context.bind).toBeUndefined()
})
test("Wry does not advertise embedded browser capabilities", async () => {
  capabilities.mockResolvedValue({ backend: "wry", embeddedBrowser: false })
  const context = await browserSessionContext()
  expect(context.mcpServers).toEqual([])
  expect(context.appendSystemPrompt).toBeUndefined()
})
