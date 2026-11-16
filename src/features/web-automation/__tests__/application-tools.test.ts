import { expect, test, vi } from "vitest"
import { applicationToolSet, CodexClient } from "@alwith/module-chat/client"

import { createFakeAgent } from "@/agent/__tests__/fake-agent"
import { FakeHubPort } from "@/agent/__tests__/fake-runtime-client"
import { createWebAutomationTools } from "../application-tools"

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))

test("new, resumed and forked conversations call native web automation with their own session IDs and no MCP", async () => {
  invoke.mockReset().mockImplementation(async (_command, args: { sessionId: string }) => ({ session: args.sessionId }))
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const tools = createWebAutomationTools().map((tool) => ({ ...tool, autoApprove: () => true }))
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex", launch: { engine: "codex" }, applicationTools: tools
  })
  const requests = vi.spyOn(port, "acpRequest")
  try {
    await client.connect()
    const fresh = await client.newSession("/project")
    await client.open("saved-browser", "/project")
    const fork = await client.fork("saved-browser", "/project")
    for (const sessionId of [fresh, "saved-browser", fork]) {
      const reply = await fake.requestTool({ sessionId, toolSetRevision: applicationToolSet(tools).revision,
        name: "browser_list", arguments: {} })
      expect(reply).toMatchObject({ success: true, contentItems: [{ type: "text", text: JSON.stringify({session: sessionId}) }] })
      expect(invoke).toHaveBeenLastCalledWith("web_automation_execute", { sessionId, name: "browser_list", args: {} })
    }
    for (const [, method, params] of requests.mock.calls) {
      if (!["session/new", "session/resume", "session/fork"].includes(method)) continue
      expect(params).toMatchObject({ _meta: { alwith: { tools: applicationToolSet(tools) } } })
      expect(JSON.stringify(params)).not.toContain("embedded_browser")
    }
  } finally { client.disconnect() }
})

test("cancellation releases only the originating native session and never reports late success", async () => {
  let finish!: (value: unknown) => void
  invoke.mockReset().mockImplementation((command: string) => command === "web_automation_execute"
    ? new Promise((resolve) => { finish = resolve }) : Promise.resolve())
  const controller = new AbortController()
  const tool = createWebAutomationTools().find((entry) => entry.name === "browser_list")!
  const result = tool.execute({}, {
    sessionId: "cancel-this-session", toolCallId: "call", turnId: "turn", signal: controller.signal,
    agent: {} as import("@alwith/module-chat/client").ApplicationToolContext["agent"]
  })
  controller.abort()
  expect(invoke).toHaveBeenCalledWith("web_automation_cancel", { sessionId: "cancel-this-session" })
  finish({ targets: [] })
  await expect(result).rejects.toThrow()
  expect(invoke.mock.calls.filter(([command]) => command === "web_automation_execute")).toHaveLength(1)
})
