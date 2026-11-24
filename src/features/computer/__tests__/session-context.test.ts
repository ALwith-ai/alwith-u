import { beforeEach, expect, test, vi } from "vitest"

const native = vi.hoisted(() => ({
  deviceContext: vi.fn(),
  browserContext: vi.fn(),
  tauri: vi.fn(() => true)
}))

vi.mock("@tauri-apps/api/core", () => ({ isTauri: native.tauri }))
vi.mock("@/features/drive/session-context", () => ({
  driveSessionContext: () => Promise.resolve({ mcpServers: [], appendSystemPrompt: "Workspace knowledge" })
}))
vi.mock("@/features/web-automation/session-context", () => ({ browserSessionContext: native.browserContext }))
vi.mock("@/features/device/session-context", () => ({ deviceSessionContext: native.deviceContext }))

import { hostSessionContext } from "../session-context"

beforeEach(() => {
  vi.clearAllMocks()
  native.tauri.mockReturnValue(true)
  native.deviceContext.mockResolvedValue({ mcpServers: [], appendSystemPrompt: "Use device_control" })
  native.browserContext.mockResolvedValue({ mcpServers: [], appendSystemPrompt: "Use browser tools" })
})

test("new, resumed and forked conversations use computer application tools without a dedicated transport", async () => {
  for (const operation of [
    { kind: "new" },
    { kind: "resume", sessionId: "history" },
    { kind: "fork", sourceSessionId: "history" }
  ] as const) {
    const context = await hostSessionContext("/project", operation)
    expect(context.mcpServers).toEqual([])
    expect(context.bind).toBeUndefined()
    expect(context.appendSystemPrompt).toContain("Workspace knowledge")
    expect(context.appendSystemPrompt).toContain("Use device_control")
    expect(context.appendSystemPrompt).toContain("Use the computer_* application tools")
  }
})

test("browser previews keep workspace context without attaching native tools", async () => {
  native.tauri.mockReturnValue(false)
  const context = await hostSessionContext("/project", { kind: "new" })
  expect(context.appendSystemPrompt).toBe("Workspace knowledge")
  expect(native.deviceContext).not.toHaveBeenCalled()
  expect(native.browserContext).not.toHaveBeenCalled()
})
