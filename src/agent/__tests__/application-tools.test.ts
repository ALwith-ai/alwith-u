import { CodexClient, defineApplicationTool } from "@alwith/module-chat/client"
import { expect, test, vi } from "vitest"

import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

test("another application uses the shared client directly across new, restored and forked sessions", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const requests = vi.spyOn(port, "acpRequest")
  const execute = vi.fn((value: number, { sessionId }: { sessionId: string }) => ({
    success: true,
    contentItems: [{ type: "text" as const, text: `${sessionId}:${value}` }]
  }))
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: { engine: "codex" },
    applicationTools: [
      defineApplicationTool({
        name: "count_rows",
        description: "Count rows",
        revision: "1",
        inputSchema: { type: "object" },
        parse: () => 42,
        execute
      })
    ]
  })
  try {
    await client.connect()
    const original = await client.newSession("/project")
    await client.open("saved", "/project")
    const fork = await client.fork(original, "/project")
    for (const method of ["session/new", "session/resume", "session/fork"])
      expect(requests.mock.calls.find((call) => call[1] === method)?.[2]).toMatchObject({
        _meta: { alwith: { tools: { definitions: [expect.objectContaining({ name: "count_rows" })] } } }
      })
    const call = (sessionId: string) =>
      fake.requestTool({
        sessionId,
        name: "count_rows",
        arguments: {},
        toolSetRevision: JSON.stringify([["count_rows", "1"]])
      })
    for (const id of [original, "saved", fork])
      expect(await call(id)).toMatchObject({ success: true, contentItems: [{ text: `${id}:42` }] })
    await client.close(fork)
    expect(await call(fork)).toMatchObject({ success: false })
    expect(execute).toHaveBeenCalledTimes(3)
  } finally {
    client.disconnect()
  }
})

test("existing consumers can retain raw tool declarations while migrating", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const requests = vi.spyOn(port, "acpRequest")
  const client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
  const tools = {
    version: 1,
    revision: "legacy",
    definitions: [{ name: "existing_tool", description: "Existing tool", inputSchema: { type: "object" } }]
  }
  try {
    await client.connect()
    await client.newSession("/project", { meta: { alwith: { tools } } })
    expect(requests.mock.calls.find((call) => call[1] === "session/new")?.[2]).toMatchObject({
      _meta: { alwith: { tools } }
    })
  } finally {
    client.disconnect()
  }
})
