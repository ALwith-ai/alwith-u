import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { deviceSessionContext } from "../session-context"

const native = { context: vi.fn(), bind: vi.fn() }

// The package's generated commands reach the device plugin through Tauri IPC.
beforeEach(() => {
  vi.clearAllMocks()
  mockIPC((command, args) => {
    if (command === "plugin:alwith-device|context") return native.context()
    if (command === "plugin:alwith-device|bind") return native.bind(args)
    throw new Error(`unexpected command ${command}`)
  })
  Object.assign(globalThis, { isTauri: true })
})
afterEach(() => {
  clearMocks()
  Reflect.deleteProperty(globalThis, "isTauri")
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
  Reflect.deleteProperty(globalThis, "isTauri")
  expect(await deviceSessionContext()).toEqual({ mcpServers: [] })
})
