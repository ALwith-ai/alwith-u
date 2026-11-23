import { asyncQuestionId, questionReplies, questionReplyEnvelope } from "@alwith/module-chat/async-question-card"
import { CodexClient } from "@alwith/module-chat/client"
import { createFakeAgent, FakeHubPort } from "@alwith/module-chat/testing"
import { afterEach, expect, test, vi } from "vitest"

import { respondMobilePermission, sendMobilePrompt } from "@/features/mobile/actions"
import { MobileQuestions } from "@/features/mobile/questions"

const clients: CodexClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect()
})
async function make(fake = createFakeAgent()) {
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

test("the normal ACP prompt path acknowledges the phone reply on its original question", async () => {
  const fake = createFakeAgent()
  const client = await make(fake)
  const sessionId = await client.newSession("/fixture")
  const messageId = "question"
  const title = "Where?"
  await fake.pushUpdate(sessionId, {
    sessionUpdate: "agent_message",
    messageId,
    content: [{ type: "text", text: title }],
    _meta: { codex: { turnId: "turn", delivery: "async", questions: [{ title, options: ["Remote"] }] } }
  })
  const bridge = new MobileQuestions()
  const id = asyncQuestionId(messageId, 0)
  const token = await vi.waitFor(() => {
    const value = bridge.project(client.state, [sessionId])[sessionId]?.[id]
    if (!value) throw new Error("Waiting for the question")
    return value
  })
  const request = "question/" + token + "/attempt"
  const message = await bridge.submit(client, sessionId, "Remote", "phone", request)
  const reply = { questionItemId: id, question: title, answer: "Remote" }
  expect(fake.prompts).toContainEqual(
    expect.objectContaining({
      sessionId,
      text: questionReplyEnvelope(reply),
      meta: expect.objectContaining({ mobile: { deviceId: "phone", clientRequestId: request } })
    })
  )
  const received = client.state.sessions[sessionId]!.items.find((item) => item.kind === "user" && item.id === message)
  expect(received?.kind).toBe("user")
  if (received?.kind === "user") {
    const replies = [
      ...questionReplies(received._meta),
      ...received.content.flatMap((block) => questionReplies(block._meta))
    ]
    expect(replies).toContainEqual(reply)
  }
})
