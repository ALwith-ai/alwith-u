import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { expect, test, vi } from "vitest"

import { CodexClient } from "../client"
import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

const model = "gateway:deepseek:deepseek-flash"
function options(mode: string): acp.SessionConfigOption[] {
  return [
    {
      configId: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: mode,
      options: ["read-only", "agent", "agent-full-access"].map((value) => ({ value, name: value }))
    },
    {
      configId: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: model,
      options: [{ groupId: "deepseek", name: "DeepSeek", options: [{ value: model, name: "DeepSeek" }] }]
    }
  ]
}

function fixture(trigger: "revision" | "preflight" | "reopen" | "fork") {
  const fake = createFakeAgent()
  // Match the adapter: an explicit host mode overrides the default on every open.
  fake.sessionOptions.current = (_model, meta) => options(String((meta?.codex as { mode?: string })?.mode ?? "agent"))
  fake.configResponse.current = (request) => ({ configOptions: options(String(request.value)) })
  const port = new FakeHubPort(() => fake.app)
  const requests = vi.spyOn(port, "acpRequest")
  let revision = "before"
  let failPreflight = false
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: { engine: "codex" },
    sessionContext: () => Promise.resolve({ revision, mcpServers: [] }),
    sessionContextRevision: () => Promise.resolve(revision),
    prepareSessionTools: async () => {
      if (failPreflight) {
        failPreflight = false
        throw new Error("Connection needs refresh")
      }
    }
  })
  return {
    client,
    requests,
    change: () => {
      if (trigger === "revision") revision = "after"
      if (trigger === "preflight") failPreflight = true
    }
  }
}

test.each(["revision", "preflight", "reopen", "fork"] as const)(
  "DeepSeek keeps user approval across %s and replies to the correct pending request",
  async (trigger) => {
    const { client, requests, change } = fixture(trigger)
    try {
      await client.connect()
      const id = await client.newSession("/tmp/approval-mode", model)
      await client.setConfig(id, "mode", "read-only")
      const unrelated = await client.newSession("/tmp/other", model)
      change()
      let target = id
      if (trigger === "reopen") {
        await client.stopSession(id)
        await client.open(id, "/tmp/approval-mode")
      } else if (trigger === "fork") target = await client.fork(id, "/tmp/approval-mode", "turn-one")
      await client.prompt(target, [{ type: "text", text: "permission" }])
      const open = requests.mock.calls.findLast(
        (call) => call[1] === (trigger === "fork" ? "session/fork" : "session/resume")
      )
      expect(open?.[2]).toMatchObject({ sessionId: id, _meta: { codex: { mode: "read-only" }, alwith: { model } } })
      if (trigger === "fork") expect(open?.[2]).toMatchObject({ _meta: { codex: { lastTurnId: "turn-one" } } })
      expect(client.session(target).configOptions.find((option) => option.configId === "mode")?.currentValue).toBe(
        "read-only"
      )
      expect(client.session(unrelated).configOptions.find((option) => option.configId === "mode")?.currentValue).toBe(
        "agent"
      )
      await vi.waitFor(() => expect(client.state.actions).toHaveLength(1))
      const action = client.state.actions[0]
      expect(action.sessionId).toBe(target)
      await client.respond(action.id, { outcome: { outcome: "selected", optionId: "allow_once" } })
      await vi.waitFor(() => expect(client.state.actions).toHaveLength(0))
      await vi.waitFor(() => expect(client.session(target).state).toBe("idle"))
    } finally {
      client.disconnect()
    }
  }
)

test("DeepSeek preserves automatic review when refreshing tools", async () => {
  const { client, requests, change } = fixture("revision")
  try {
    await client.connect()
    const id = await client.newSession("/tmp/approval-mode", model)
    await client.setConfig(id, "mode", "read-only")
    await client.setConfig(id, "mode", "agent")
    change()
    await client.prompt(id, [{ type: "text", text: "hello" }])
    const resumed = requests.mock.calls.findLast((call) => call[1] === "session/resume")
    expect(resumed?.[2]).toMatchObject({ sessionId: id, _meta: { codex: { mode: "agent" }, alwith: { model } } })
    expect(client.session(id).configOptions.find((option) => option.configId === "mode")?.currentValue).toBe("agent")
  } finally {
    client.disconnect()
  }
})
