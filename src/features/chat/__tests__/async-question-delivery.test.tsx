import { asyncQuestionId, questionReplyEnvelope } from "@alwith/module-chat/async-question-card"
import { applyUpdate, createSession, type Session } from "@alwith/module-chat/client"
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { MobileQuestions } from "@/features/mobile/questions"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { renderTimeline } from "./timeline-host"

const original = client.state
afterEach(() => {
  cleanup()
  client.store.setState(original, true)
  vi.restoreAllMocks()
})

test("a completed async question packet remains selectable after the assistant turn ends", async () => {
  await initI18n("en")
  const id = "async-delivery"
  const messageId = "async-question"
  const title = "How did you start the development app?"
  const options = ["Run bun dev:tauri", "Open the development app", "Use an IDE task"]
  const text = `${title}\n\n${options.map((option) => `- ${option}`).join("\n")}`
  let session: Session = { ...createSession(id, "/tmp"), attached: true }
  const update = (frame: unknown) => {
    session = applyUpdate(session, frame as never)
    client.store.setState({ connection: "ready", sessions: { [id]: session } })
  }
  update({
    sessionUpdate: "user_message",
    messageId: "request",
    content: [{ type: "text", text: "Investigate the startup issue" }],
    _meta: { codex: { turnId: "turn" } }
  })
  update({ sessionUpdate: "state_update", state: "running" })
  // The native stream starts the item, emits its prose, then supplies the question on completion.
  update({
    sessionUpdate: "agent_message",
    messageId,
    content: [],
    _meta: { codex: { turnId: "turn", phase: "final_answer", delivery: "async" } }
  })
  update({
    sessionUpdate: "agent_message_chunk",
    messageId,
    content: { type: "text", text },
    _meta: { codex: { phase: "final_answer" } }
  })
  update({
    sessionUpdate: "agent_message",
    messageId,
    content: [{ type: "text", text }],
    _meta: {
      codex: {
        turnId: "turn",
        phase: "final_answer",
        delivery: "async",
        messageCompleted: true,
        questions: [{ title, options }]
      }
    }
  })
  const view = renderTimeline(session)
  const question = within(await view.findByRole("region", { name: title }))
  expect(question.getByRole("button", { name: "Submit answer" })).toBeEnabled()
  await act(async () => {
    update({ sessionUpdate: "state_update", state: "idle", stopReason: "end_turn", userMessageId: "request" })
  })
  const send = vi.spyOn(client, "prompt").mockResolvedValue("answer")
  fireEvent.click(question.getByRole("radio", { name: "Use an IDE task" }))
  fireEvent.click(question.getByRole("button", { name: "Submit answer" }))
  const reply = { questionItemId: asyncQuestionId(messageId, 0), question: title, answer: options[2] }
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(id, [
      { type: "text", text: questionReplyEnvelope(reply), _meta: { codex: { questionReply: reply } } }
    ])
  )
})

test("a phone answers the active desktop card and a stale or replayed question stays closed", async () => {
  await initI18n("en")
  const bridge = new MobileQuestions()
  const id = "async-phone"
  const messageId = "q/中文"
  const itemId = asyncQuestionId(messageId, 0)
  const title = "Choose a destination"
  const frame = {
    sessionUpdate: "agent_message",
    messageId,
    content: [{ type: "text", text: title }],
    _meta: { codex: { turnId: "turn", delivery: "async", questions: [{ title, options: ["Local", "Remote"] }] } }
  }
  const session = applyUpdate({ ...createSession(id, "/tmp"), attached: true }, frame as never)
  client.store.setState({ connection: "ready", sessions: { [id]: session } })
  const view = renderTimeline(session)
  const card = within(await view.findByRole("region", { name: title }))
  const token = bridge.project(client.state, [id])[id]![itemId]
  expect(token).toBeTruthy()
  expect(bridge.project(client.state, [id])[id]![itemId]).toBe(token)
  const request = "question/" + token + "/nonce"
  const answer = " Use the remote machine "
  const send = vi.spyOn(client, "prompt").mockImplementation(async (_sessionId, content) => {
    const updated = applyUpdate(session, {
      sessionUpdate: "user_message",
      messageId: "accepted",
      content,
      _meta: { codex: { turnId: "turn" } }
    } as never)
    client.store.setState({ sessions: { [id]: updated } })
    return "accepted"
  })
  await expect(bridge.submit(client, "other", answer, "phone", request)).rejects.toThrow("no longer available")
  await act(async () => {
    await bridge.submit(client, id, answer, "phone", request)
  })
  const reply = { questionItemId: itemId, question: title, answer }
  expect(send).toHaveBeenCalledExactlyOnceWith(
    id,
    [{ type: "text", text: questionReplyEnvelope(reply), _meta: { codex: { questionReply: reply } } }],
    { meta: { mobile: { deviceId: "phone", clientRequestId: request } } }
  )
  expect(card.getByText(answer.trim())).toBeVisible()
  expect(card.queryByRole("button", { name: "Submit answer" })).toBeNull()
  expect(bridge.project(client.state, [id])).toEqual({})
  await expect(bridge.submit(client, id, answer, "phone", request)).rejects.toThrow("no longer available")
  client.store.setState({ sessions: { [id]: session } })
  const fresh = bridge.project(client.state, [id])[id]![itemId]
  const newer = applyUpdate(session, {
    sessionUpdate: "agent_message",
    messageId: "new",
    content: [{ type: "text", text: "Next" }],
    _meta: { codex: { turnId: "next" } }
  } as never)
  client.store.setState({ sessions: { [id]: newer } })
  await expect(bridge.submit(client, id, answer, "phone", "question/" + fresh + "/nonce")).rejects.toThrow(
    "no longer available"
  )
  expect(bridge.project(client.state, [id])).toEqual({})
  client.store.setState({
    sessions: { [id]: { ...session, items: session.items.map((item) => ({ ...item, replayed: true })) } }
  })
  expect(bridge.project(client.state, [id])).toEqual({})
  expect(send).toHaveBeenCalledTimes(1)
})
