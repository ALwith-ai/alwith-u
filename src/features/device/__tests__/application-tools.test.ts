import { CodexClient } from "@alwith/module-chat/client"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { createFakeAgent } from "@alwith/module-chat/testing"
import { FakeHubPort } from "@alwith/module-chat/testing"

import { createDeviceTools } from "../application-tools"

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
afterEach(() => clearMocks())

beforeEach(() => {
  mockIPC((command, args) => invoke(command, args))
  invoke.mockReset().mockImplementation(async (command: string, args: { sessionId: string }) => {
    if (command === "plugin:alwith-device|tools")
      return ["control", "logs"].map((name) => ({ name, description: name, inputSchema: { type: "object" } }))
    if (command === "plugin:alwith-device|tool_call")
      return { isError: false, content: [{ type: "text", text: args.sessionId }] }
    throw new Error(`Unexpected command: ${command}`)
  })
})

test("new, resumed and forked sessions call the shared native device service without MCP", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const tools = await createDeviceTools()
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: { engine: "codex" },
    applicationTools: tools
  })
  const requests = vi.spyOn(port, "acpRequest")
  try {
    await client.connect()
    const fresh = await client.newSession("/mobile")
    await client.open("saved-mobile", "/mobile")
    const fork = await client.fork("saved-mobile", "/mobile")
    for (const sessionId of [fresh, "saved-mobile", fork]) {
      const result = await fake.requestTool({
        sessionId,
        name: "device_control",
        arguments: { action: "list_devices" }
      })
      expect(result).toMatchObject({ result: { content: [{ type: "text", text: sessionId }] } })
      expect(invoke).toHaveBeenLastCalledWith(
        "plugin:alwith-device|tool_call",
        expect.objectContaining({
          sessionId,
          name: "control",
          arguments: { action: "list_devices" },
          requestId: expect.any(String)
        })
      )
    }
    for (const [, method, params] of requests.mock.calls) {
      if (!["session/new", "session/resume", "session/fork"].includes(method)) continue
      expect(params).toMatchObject({ mcpServers: [{ type: "acp", name: "alwith" }] })
      expect(JSON.stringify(params)).not.toContain("stdio.mjs")
    }
  } finally {
    client.disconnect()
  }
})

test("missing native tools fail visibly rather than silently disappearing", async () => {
  invoke.mockRejectedValue(new Error("Device native library missing"))
  await expect(createDeviceTools()).rejects.toThrow("Device native library missing")
})

test("cancellation includes the originating session and call, and refuses a late success", async () => {
  const tool = (await createDeviceTools())[0]
  let finish!: (value: unknown) => void
  invoke.mockImplementation((command: string) =>
    command === "plugin:alwith-device|tool_call"
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve(null)
  )
  const controller = new AbortController()
  const result = tool.execute(
    { action: "attach" },
    {
      sessionId: "a",
      toolCallId: "call-a",
      turnId: "turn-a",
      signal: controller.signal,
      agent: createFakeAgent().app as never
    }
  )
  controller.abort()
  expect(invoke).toHaveBeenCalledWith("plugin:alwith-device|tool_cancel", { sessionId: "a", requestId: "call-a" })
  finish({ isError: false, content: [{ type: "text", text: "late" }] })
  await expect(result).rejects.toThrow()
})
