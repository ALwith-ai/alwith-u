import { asyncQuestionId, questionReplyEnvelope } from "@alwith/module-chat/async-question-card"
import { applyUpdate, createSession, type Session } from "@alwith/module-chat/client"
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

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
