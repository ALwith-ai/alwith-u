import { afterEach, expect, test, vi } from "vitest"

import { respondMobilePermission, sendMobilePrompt } from "@/features/mobile/actions"

import { CodexClient } from "../client"
import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

const clients: CodexClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect()
})
async function make() {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
  clients.push(client)
  await client.connect()
  return client
}

test("mobile sends to the explicit session and resolves only its matching permission", async () => {
  const client = await make()
  const first = await client.newSession("/first")
  const second = await client.newSession("/second")
  await sendMobilePrompt(client, { sessionId: first, text: "permission" })
  await sendMobilePrompt(client, { sessionId: second, text: "permission" })
  await vi.waitFor(() => expect(client.state.actions).toHaveLength(2))
  respondMobilePermission(client, {
    sessionId: first,
    toolCallId: "permission-tool",
    outcome: { outcome: "selected", optionId: "allow_once" }
  })
  expect(client.state.actions.map((action) => action.sessionId)).toEqual([second])
  respondMobilePermission(client, {
    sessionId: first,
    toolCallId: "permission-tool",
    outcome: { outcome: "cancelled" }
  })
  expect(client.state.actions.map((action) => action.sessionId)).toEqual([second])
  await client.cancel(second)
  await vi.waitFor(() => expect(client.state.actions).toHaveLength(0))
})

test("mobile resumes a Runtime session without changing the local chat slot", async () => {
  const client = await make()
  const remote = await client.newSession("/remote")
  await client.stopSession(remote)
  const local = await client.newSession("/local")
  client.applyRunStates([
    {
      sessionId: remote,
      state: "idle",
      reusableDraft: false,
      owner: "stdio",
      cwd: "/remote",
      title: "Remote",
      since: 0,
      lastActivityAt: 0,
      version: 1,
      interruption: null,
      tasks: [],
      listeningPorts: [],
      executionId: null,
      executionRole: null
    }
  ])
  const slots = { ...client.state.sessionWindows }
  await sendMobilePrompt(client, { sessionId: remote, text: "hello" })
  expect(client.state.sessions[remote].attached).toBe(true)
  expect(client.state.sessions[local].attached).toBe(true)
  expect(client.state.sessionWindows).toEqual(slots)
})
