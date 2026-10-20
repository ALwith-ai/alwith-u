import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { expect, test, vi } from "vitest"

import { CodexClient } from "../client"
import type { ClientOptions } from "../client"
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
  const context = vi.fn<NonNullable<ClientOptions["sessionContext"]>>(async cwd => ({
    mcpServers: [server],
    appendSystemPrompt: `Knowledge for ${cwd}`
  }))
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
      systemPrompt: { mode: "append", content: [{ type: "text", text: "Knowledge for /tmp/project" }] }
    })
    expect(created).not.toHaveProperty("_meta")
    await client.fork(id, "/tmp/other")
    const fork = request.mock.calls.find(call => call[1] === "session/fork")?.[2]
    expect(fork).toMatchObject({
      sessionId: id,
      cwd: "/tmp/other",
      mcpServers: [server],
      systemPrompt: { mode: "append", content: [{ type: "text", text: "Knowledge for /tmp/other" }] }
    })
    await client.open(id, "/tmp/project")
    expect(context.mock.calls).toEqual([
      ["/tmp/project", { kind: "new" }],
      ["/tmp/other", { kind: "fork", sourceSessionId: id }]
    ])
    await client.close(id)
    await client.open(id, "/tmp/project")
    expect(context.mock.calls.at(-1)).toEqual(["/tmp/project", { kind: "resume", sessionId: id }])
    expect(JSON.stringify(client.state)).not.toContain("Bearer test")
  } finally {
    client.disconnect()
  }
})

test.each(["cancel", "close", "stopSession"] as const)(
  "%s revokes only the target and still stops Codex when cleanup fails",
  async method => {
    const fake = createFakeAgent()
    const port = new FakeHubPort(() => fake.app)
    const request = vi.spyOn(port, "acpRequest")
    const notify = vi.spyOn(port, "acpNotify")
    const revoke = vi.fn(async () => {
      throw new Error("Native cleanup failed")
    })
    const client = new CodexClient(async () => port, {
      agentId: "codex",
      launch: { engine: "codex" },
      revokeSessionAccess: revoke
    })
    try {
      await client.connect()
      const target = await client.newSession("/tmp/same")
      await client.newSession("/tmp/same")
      await expect(client[method](target)).rejects.toThrow("Native cleanup failed")
      expect(revoke).toHaveBeenCalledExactlyOnceWith(target)
      const calls = method === "cancel" ? notify.mock.calls : request.mock.calls
      expect(
        calls.some(
          call =>
            call[1] === (method === "cancel" ? "session/cancel" : "session/close") &&
            (call[2] as { sessionId: string }).sessionId === target
        )
      ).toBe(true)
    } finally {
      client.disconnect()
    }
  }
)

test.each(["archive", "delete"] as const)("%s revokes the source before changing lifecycle", async method => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const request = vi.spyOn(port, "acpRequest")
  const revoke = vi.fn(async () => {
    throw new Error("revocation blocked")
  })
  const client = new CodexClient(async () => port, {
    agentId: "codex",
    launch: { engine: "codex" },
    revokeSessionAccess: revoke
  })
  try {
    await client.connect()
    const id = await client.newSession("/tmp/project")
    request.mockClear()
    await expect(client[method](id)).rejects.toThrow("revocation blocked")
    expect(revoke).toHaveBeenCalledExactlyOnceWith(id)
    expect(
      request.mock.calls.some(call => ["session/fork", "session/delete", "_codex/session_archive"].includes(call[1]))
    ).toBe(false)
  } finally {
    client.disconnect()
  }
})

test("global tool changes refresh existing sessions before prompting without replacing their identity", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const request = vi.spyOn(port, "acpRequest")
  let revision = "disabled"
  const client = new CodexClient(async () => port, {
    agentId: "codex",
    launch: { engine: "codex" },
    sessionContext: async () => ({
      revision,
      mcpServers:
        revision === "disabled" ? [] : [{ type: "stdio", name: "computer", command: "/driver", args: ["mcp"], env: [] }]
    }),
    sessionContextRevision: async () => revision
  })
  try {
    await client.connect()
    const a = await client.newSession("/a")
    const b = await client.newSession("/b")
    revision = "global-1"
    request.mockClear()
    await client.prompt(a, [{ type: "text", text: "First" }])
    const calls = request.mock.calls.filter(call =>
      ["session/close", "session/resume", "session/prompt"].includes(call[1])
    )
    expect(calls.map(call => call[1])).toEqual(["session/close", "session/resume", "session/prompt"])
    expect(calls.every(call => (call[2] as { sessionId: string }).sessionId === a)).toBe(true)
    expect(calls[1]?.[2]).toMatchObject({ mcpServers: [{ name: "computer" }] })
    expect(calls[1]?.[2]).not.toHaveProperty("revision")
    request.mockClear()
    await client.prompt(b, [{ type: "text", text: "Second" }])
    expect(request.mock.calls.find(call => call[1] === "session/resume")?.[2]).toMatchObject({
      sessionId: b,
      mcpServers: [{ name: "computer" }]
    })
    const fork = await client.fork(a, "/a")
    request.mockClear()
    await client.prompt(fork, [{ type: "text", text: "Fork" }])
    expect(request.mock.calls.some(call => call[1] === "session/resume")).toBe(false)
  } finally {
    client.disconnect()
  }
})

test("native ownership binds returned identities and forking never revokes the source", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const request = vi.spyOn(port, "acpRequest")
  const bind = vi.fn(async (_id: string) => {})
  const revoke = vi.fn(async (_id: string) => {})
  const client = new CodexClient(async () => port, {
    agentId: "codex",
    launch: { engine: "codex" },
    sessionContext: async () => ({ mcpServers: [], bind }),
    revokeSessionAccess: revoke
  })
  try {
    await client.connect()
    const source = await client.newSession("/project")
    expect(bind).toHaveBeenLastCalledWith(source)
    const child = await client.fork(source, "/project")
    expect(child).not.toBe(source)
    expect(bind).toHaveBeenLastCalledWith(child)
    expect(revoke).not.toHaveBeenCalled()
    for (const call of request.mock.calls.filter(call => ["session/new", "session/fork"].includes(call[1]))) {
      expect(call[2]).not.toHaveProperty("bind")
    }
  } finally {
    client.disconnect()
  }
})

test.each([false, true])(
  "tool preflight reconnects once before dispatch (persistent failure: %s)",
  async persistent => {
    const fake = createFakeAgent()
    const port = new FakeHubPort(() => fake.app)
    const request = vi.spyOn(port, "acpRequest")
    const prepare = vi.fn(async (_id: string) => {
      if (persistent || prepare.mock.calls.length === 1) throw new Error("MCP unavailable")
    })
    const client = new CodexClient(async () => port, {
      agentId: "codex",
      launch: { engine: "codex" },
      prepareSessionTools: prepare
    })
    try {
      await client.connect()
      const id = await client.newSession("/a")
      await client.newSession("/b")
      request.mockClear()
      const sent = client.prompt(id, [{ type: "text", text: "Verify computer" }])
      if (persistent) await expect(sent).rejects.toThrow("MCP unavailable")
      else await sent
      expect(prepare.mock.calls).toEqual([[id], [id]])
      const calls = request.mock.calls.filter(call =>
        ["session/close", "session/resume", "session/prompt"].includes(call[1])
      )
      expect(calls.map(call => call[1])).toEqual(
        persistent ? ["session/close", "session/resume"] : ["session/close", "session/resume", "session/prompt"]
      )
      expect(calls.every(call => (call[2] as { sessionId: string }).sessionId === id)).toBe(true)
    } finally {
      client.disconnect()
    }
  }
)
