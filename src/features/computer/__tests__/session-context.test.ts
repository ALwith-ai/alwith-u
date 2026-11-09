import { beforeEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"
const native = vi.hoisted(() => ({
  ready: vi.fn(),
  context: vi.fn(),
  revision: vi.fn(),
  bind: vi.fn(),
  deviceContext: vi.fn(),
  tauri: vi.fn(() => true)
}))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: native.tauri }))
vi.mock("@alwith/module-computer/commands", () => ({
  commands: { ready: native.ready, context: native.context, revision: native.revision, bind: native.bind }
}))
vi.mock("@/features/drive/session-context", () => ({
  driveSessionContext: () => Promise.resolve({ mcpServers: [], appendSystemPrompt: "Workspace knowledge" })
}))
vi.mock("@/features/device/session-context", () => ({ deviceSessionContext: native.deviceContext }))
import { hostSessionContext } from "../session-context"
beforeEach(async () => {
  await initI18n("en")
  vi.clearAllMocks()
  native.tauri.mockReturnValue(true)
  native.context.mockResolvedValue(null)
  native.revision.mockResolvedValue("disabled")
  native.bind.mockResolvedValue(undefined)
  native.deviceContext.mockResolvedValue({ mcpServers: [] })
})
test("all new, resumed and forked conversations receive the application grant", async () => {
  native.context.mockResolvedValue({
    token: "token",
    connection: { generation: "global", command: "/driver", args: ["mcp"], env: [] }
  })
  for (const operation of [
    { kind: "new" },
    { kind: "resume", sessionId: "a" },
    { kind: "resume", sessionId: "b" },
    { kind: "fork", sourceSessionId: "a" }
  ] as const) {
    const context = await hostSessionContext("/project", operation)
    expect(context.mcpServers).toHaveLength(1)
    expect(context).not.toHaveProperty("revision")
    await context.bind?.("destination")
    expect(native.bind).toHaveBeenLastCalledWith({ token: "token", sessionId: "destination" })
    expect(context.appendSystemPrompt).toContain("Workspace knowledge")
    expect(context.appendSystemPrompt).not.toContain("generate_image")
  }
  expect(native.context.mock.calls.every((args) => args.length === 0)).toBe(true)
})
test("an unavailable computer host does not remove the workspace context", async () => {
  expect((await hostSessionContext("/project", { kind: "new" })).mcpServers).toEqual([])
  native.context.mockRejectedValue(new Error("Computer module unavailable"))
  const error = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    const context = await hostSessionContext("/project", { kind: "resume", sessionId: "history" })
    expect(context.mcpServers).toEqual([])
    expect(context.appendSystemPrompt).toContain("Workspace knowledge")
  } finally {
    error.mockRestore()
  }
})
test("browser previews never invoke native commands", async () => {
  native.tauri.mockReturnValue(false)
  await hostSessionContext("/project", { kind: "new" })
  expect(native.context).not.toHaveBeenCalled()
})

test("device binding still completes before session context binding resolves", async () => {
  let complete!: () => void
  const bind = vi.fn(() => new Promise<void>((resolve) => (complete = resolve)))
  native.deviceContext.mockResolvedValue({ mcpServers: [], bind })
  const context = await hostSessionContext("/project", { kind: "new" })
  let finished = false
  const binding = context.bind?.("destination").then(() => {
    finished = true
  })
  await Promise.resolve()
  expect(bind).toHaveBeenCalledWith("destination")
  expect(finished).toBe(false)
  complete()
  await binding
  expect(finished).toBe(true)
})

test("computer binding can fail without rejecting history replay or checking Driver readiness", async () => {
  native.context.mockResolvedValue({
    token: "token",
    connection: { generation: "broker", command: "/broker", args: [], env: [] }
  })
  let reject!: (error: Error) => void
  native.bind.mockReturnValue(
    new Promise<void>((_resolve, fail) => {
      reject = fail
    })
  )
  const error = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    const context = await hostSessionContext("/project", { kind: "resume", sessionId: "history" })
    await context.bind?.("history")
    expect(native.bind).toHaveBeenCalledWith({ token: "token", sessionId: "history" })
    expect(native.ready).not.toHaveBeenCalled()
    expect(native.revision).not.toHaveBeenCalled()
    reject(new Error("Computer connection closed"))
    await Promise.resolve()
    expect(error).toHaveBeenCalledWith("Cannot bind computer access", expect.any(Error))
  } finally {
    error.mockRestore()
  }
})
