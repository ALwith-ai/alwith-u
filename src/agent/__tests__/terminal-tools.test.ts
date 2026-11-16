import { CodexClient } from "@alwith/module-chat/client"
import { TerminalClient, type TerminalSnapshot } from "@alwith/module-terminal"
import { expect, test, vi } from "vitest"

import { createTerminalTools } from "@/features/terminal/tools"

import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

test("application terminals bind native actions to the requesting chat across turns and reject foreign arguments", async () => {
  const native = vi.fn((method: string, params: Record<string, unknown>) => {
    if (method === "start")
      return Promise.resolve({
        ...params,
        generation: 1,
        sequence: 1,
        state: "running",
        outputBase64: "",
        screenBase64: "",
        text: "server ready",
        exitCode: null,
        error: null
      } as unknown as TerminalSnapshot)
    if (method === "snapshot") return Promise.resolve(null)
    if (method === "list") return Promise.resolve([])
    throw new Error(`Unexpected native method: ${method}`)
  })
  const service = new TerminalClient(native as never)
  const fake = createFakeAgent(),
    port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: { engine: "codex" },
    applicationTools: ({ cwd }) => createTerminalTools(service, cwd)
  })
  const revision = JSON.stringify(createTerminalTools(service, "/project").map((tool) => [tool.name, tool.revision]))
  try {
    await client.connect()
    const a = await client.newSession("/project/a"),
      b = await client.newSession("/project/b")
    const call = (sessionId: string, name: string, args: unknown) =>
      fake.requestTool({ sessionId, toolSetRevision: revision, name, arguments: args })
    const result = await call(a, "terminal_start", { command: "bun dev" })
    expect(result).toMatchObject({ success: true })
    expect(native).toHaveBeenLastCalledWith(
      "start",
      expect.objectContaining({ sessionId: a, cwd: "/project/a", command: "bun dev", interactive: false })
    )
    expect(JSON.stringify(result)).not.toContain("Base64")
    expect(await call(b, "terminal_list", {})).toMatchObject({ success: true })
    expect(native).toHaveBeenLastCalledWith("list", { sessionId: b })
    const count = native.mock.calls.length
    expect(await call(a, "terminal_start", { sessionId: b, command: "wrong" })).toMatchObject({ success: false })
    expect(native).toHaveBeenCalledTimes(count)
    expect(await call(a, "read_thread_terminal", {})).toMatchObject({
      success: true,
      contentItems: [{ type: "text", text: "No application terminal is attached to this chat." }]
    })
    expect(native).toHaveBeenLastCalledWith("snapshot", { sessionId: a, terminalId: null })
  } finally {
    client.disconnect()
  }
})
