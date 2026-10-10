import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { expect, test, vi } from "vitest"
import { CodexClient } from "../client"
import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

test("host session context is resolved for each explicit session operation without replacing model hints", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const request = vi.spyOn(port, "acpRequest")
  const server: acp.McpServer = {
    type: "http",
    name: "drive",
    url: "https://example.test/mcp/drive",
    headers: [{ name: "Authorization", value: "Bearer test" }]
  }
  const context = vi.fn(async (cwd: string) => ({ mcpServers: [server], appendSystemPrompt: `Knowledge for ${cwd}` }))
  const client = new CodexClient(async () => port, {
    agentId: "codex",
    launch: { engine: "codex" },
    sessionContext: context
  })
  try {
    await client.connect()
    const id = await client.newSession("/tmp/project")
    const created = request.mock.calls.find(call => call[1] === "session/new")?.[2]
    expect(created).toMatchObject({
      cwd: "/tmp/project",
      mcpServers: [server],
      _meta: { alwith: { appendSystemPrompt: "Knowledge for /tmp/project" } }
    })
    await client.fork(id, "/tmp/other")
    const fork = request.mock.calls.find(call => call[1] === "session/fork")?.[2]
    expect(fork).toMatchObject({
      sessionId: id,
      cwd: "/tmp/other",
      mcpServers: [server],
      _meta: { alwith: { appendSystemPrompt: "Knowledge for /tmp/other" } }
    })
    expect(context.mock.calls.map(call => call[0])).toEqual(["/tmp/project", "/tmp/other"])
    expect(JSON.stringify(client.state)).not.toContain("Bearer test")
  } finally {
    client.disconnect()
  }
})
