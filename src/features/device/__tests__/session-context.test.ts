import { beforeEach, expect, test, vi } from "vitest"

const native = vi.hoisted(() => ({
  context: vi.fn(),
  bind: vi.fn(),
  tauri: vi.fn(() => true)
}))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: native.tauri }))
vi.mock("@/bindings", () => ({ commands: { deviceContext: native.context, deviceBind: native.bind } }))
import { deviceSessionContext } from "../session-context"

beforeEach(() => {
  vi.clearAllMocks()
  native.tauri.mockReturnValue(true)
})
test("a registration becomes one stdio server bound to the session later", async () => {
  native.context.mockResolvedValue({
    registration: { address: "127.0.0.1:5000", token: "secret" },
    carrier: { command: "/bun", args: ["--no-install"], proxy: "/res/device/stdio.mjs" }
  })
  const context = await deviceSessionContext()
  expect(context.mcpServers).toHaveLength(1)
  expect(context.mcpServers[0].name).toBe("alwith_device")
  expect(context.mcpServers[0].args).toEqual(["--no-install", "/res/device/stdio.mjs", "127.0.0.1:5000", "secret"])
  expect(context.appendSystemPrompt).toContain("alwith_device")
  await context.bind?.("session-1")
  expect(native.bind).toHaveBeenCalledWith({ token: "secret", sessionId: "session-1" })
})
test("no platform support or a failing host yields no server", async () => {
  native.context.mockResolvedValue(null)
  expect(await deviceSessionContext()).toEqual({ mcpServers: [] })
  native.context.mockRejectedValue(new Error("no native module"))
  expect(await deviceSessionContext()).toEqual({ mcpServers: [] })
  native.tauri.mockReturnValue(false)
  expect(await deviceSessionContext()).toEqual({ mcpServers: [] })
})
