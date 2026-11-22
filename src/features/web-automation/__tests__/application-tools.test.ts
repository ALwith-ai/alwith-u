import { CodexClient } from "@alwith/module-chat/client"
import { expect, test, vi } from "vitest"

import { createFakeAgent } from "@alwith/module-chat/testing"
import { FakeHubPort } from "@alwith/module-chat/testing"

import { createWebAutomationTools } from "../application-tools"

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))

test("new, resumed and forked conversations call native web automation with their own session IDs and no MCP", async () => {
  invoke.mockReset().mockImplementation(async (_command, args: { sessionId: string }) => ({ session: args.sessionId }))
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const tools = createWebAutomationTools()
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: { engine: "codex" },
    applicationTools: tools
  })
  const requests = vi.spyOn(port, "acpRequest")
  try {
    await client.connect()
    const fresh = await client.newSession("/project")
    await client.open("saved-browser", "/project")
    const fork = await client.fork("saved-browser", "/project")
    for (const sessionId of [fresh, "saved-browser", fork]) {
      const reply = await fake.requestTool({
        sessionId,
        name: "browser_list",
        arguments: {}
      })
      expect(reply).toMatchObject({
        result: { content: [{ type: "text", text: JSON.stringify({ session: sessionId }) }] }
      })
      expect(invoke).toHaveBeenLastCalledWith("web_automation_execute", { sessionId, name: "browser_list", args: {} })
    }
    for (const [, method, params] of requests.mock.calls) {
      if (!["session/new", "session/resume", "session/fork"].includes(method)) continue
      expect(params).toMatchObject({ mcpServers: [{ type: "acp", name: "alwith" }] })
      expect(JSON.stringify(params)).not.toContain("embedded_browser")
    }
  } finally {
    client.disconnect()
  }
})

test("cancellation releases only the originating native session and never reports late success", async () => {
  let finish!: (value: unknown) => void
  invoke.mockReset().mockImplementation((command: string) =>
    command === "web_automation_execute"
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve()
  )
  const controller = new AbortController()
  const tool = createWebAutomationTools().find((entry) => entry.name === "browser_list")!
  const result = tool.execute(
    {},
    {
      sessionId: "cancel-this-session",
      toolCallId: "call",
      turnId: "turn",
      signal: controller.signal,
      agent: {} as import("@alwith/module-chat/client").ApplicationToolContext["agent"]
    }
  )
  controller.abort()
  expect(invoke).toHaveBeenCalledWith("web_automation_cancel", { sessionId: "cancel-this-session" })
  finish({ targets: [] })
  await expect(result).rejects.toThrow()
  expect(invoke.mock.calls.filter(([command]) => command === "web_automation_execute")).toHaveLength(1)
})

test("read-only observations are annotated so the agent runs them without asking, while actions keep its approval", () => {
  const tools = createWebAutomationTools()
  expect(tools.find((tool) => tool.name === "browser_read_page")?.annotations).toEqual({ readOnlyHint: true })
  expect(tools.find((tool) => tool.name === "browser_type")?.annotations).toBeUndefined()
  expect(tools.find((tool) => tool.name === "browser_evaluate")?.annotations).toBeUndefined()
})

test("screenshots are delivered as image content, not base64 embedded in text", async () => {
  invoke.mockReset().mockResolvedValue({
    imageId: "capture",
    region: { x: 0, y: 0, width: 10, height: 10 },
    image: { mimeType: "image/png", data: "aW1hZ2U=" }
  })
  const tool = createWebAutomationTools().find((entry) => entry.name === "browser_screenshot")!
  const result = await tool.execute(
    { target: "guest" },
    {
      sessionId: "a",
      toolCallId: "image",
      turnId: "turn",
      signal: new AbortController().signal,
      agent: {} as import("@alwith/module-chat/client").ApplicationToolContext["agent"]
    }
  )
  expect(result.content[1]).toEqual({ type: "image", mimeType: "image/png", data: "aW1hZ2U=" })
  expect(result.content[0]).toMatchObject({ type: "text", text: expect.not.stringContaining("aW1hZ2U=") })
})

test("a rejected replacement is not reported as successful application execution", async () => {
  invoke.mockReset().mockResolvedValue({ ok: false, matchesRequestedText: false })
  const tool = createWebAutomationTools().find((entry) => entry.name === "browser_type")!
  const result = await tool.execute(
    { target: "guest", selector: "input", text: "new" },
    {
      sessionId: "a",
      toolCallId: "type",
      turnId: "turn",
      signal: new AbortController().signal,
      agent: {} as import("@alwith/module-chat/client").ApplicationToolContext["agent"]
    }
  )
  expect(result.isError).toBe(true)
})
