import { type MessageItem } from "@alwith/api"
import { asyncQuestionId, questionReplyEnvelope } from "@alwith/module-chat/async-question-card"
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { useStore } from "zustand"

import { createFakeAgent } from "@/agent/__tests__/fake-agent"
import { FakeHubPort } from "@/agent/__tests__/fake-runtime-client"
import { type AppState, CodexClient } from "@/agent/client"
import { initI18n } from "@/lib/i18n"

const owner = vi.hoisted(() => ({ current: null as CodexClient | null }))
vi.mock("@/lib/client", () => ({
  get client() {
    if (!owner.current) throw new Error("Missing test client")
    return owner.current
  },
  useApp: <T,>(selector: (state: AppState) => T) => {
    if (!owner.current) throw new Error("Missing test client")
    return useStore(owner.current.store, selector)
  }
}))
const { AsyncQuestions } = await import("../async-questions")
const { AssistantTurn } = await import("../codex/assistant-turn")
const { UserMessage } = await import("../codex/user-message")
const { groupTurns } = await import("../turns")
await initI18n("en")
afterEach(() => {
  cleanup()
  owner.current?.disconnect()
  owner.current = null
  vi.restoreAllMocks()
})

test("a batch keeps question indices independent and skipping never sends a reply", async () => {
  const { client, id, item } = await setup()
  const send = vi.spyOn(client, "prompt").mockResolvedValue()
  const batch = {
    ...item,
    _meta: {
      codex: {
        turnId: "turn",
        delivery: "async",
        questions: [
          { title: "First", options: ["A", "B"] },
          { title: "Second", options: null }
        ]
      }
    }
  }
  const view = render(<AsyncQuestions sessionId={id} item={batch} />)
  fireEvent.click(within(view.getByRole("region", { name: "First" })).getByRole("button", { name: "Skip" }))
  expect(send).not.toHaveBeenCalled()
  expect(within(view.getByRole("region", { name: "First" })).getByText("Skipped")).toBeInTheDocument()
  const second = within(view.getByRole("region", { name: "Second" }))
  expect(second.getByRole("button", { name: "Submit answer" })).toBeDisabled()
  fireEvent.change(second.getByRole("textbox"), { target: { value: "Free-form answer" } })
  fireEvent.click(second.getByRole("button", { name: "Submit answer" }))
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(id, [
      {
        type: "text",
        text: questionReplyEnvelope({
          questionItemId: asyncQuestionId(item.id, 1),
          question: "Second",
          answer: "Free-form answer"
        }),
        _meta: {
          codex: {
            questionReply: {
              questionItemId: asyncQuestionId(item.id, 1),
              question: "Second",
              answer: "Free-form answer"
            }
          }
        }
      }
    ])
  )
  view.unmount()
})

async function setup() {
  const fake = createFakeAgent()
  const client = new CodexClient(() => Promise.resolve(new FakeHubPort(() => fake.app)), {
    agentId: "codex",
    launch: { engine: "codex" }
  })
  owner.current = client
  await client.connect()
  const id = await client.newSession("/qa/async")
  const messageId = crypto.randomUUID()
  const question = async (
    sessionId = id,
    text = "Which environment?",
    options: string[] | null = ["Local", "Remote"]
  ) => {
    await fake.pushUpdate(sessionId, {
      sessionUpdate: "user_message",
      messageId: "prompt",
      content: [{ type: "text", text: "go" }],
      _meta: { codex: { turnId: "turn" } }
    })
    await fake.pushUpdate(sessionId, { sessionUpdate: "state_update", state: "running" })
    await fake.pushUpdate(sessionId, {
      sessionUpdate: "agent_message",
      messageId,
      content: [{ type: "text", text }],
      _meta: {
        codex: { turnId: "turn", phase: "final_answer", delivery: "async", questions: [{ title: text, options }] }
      }
    })
    await vi.waitFor(() =>
      expect(client.state.sessions[sessionId]?.items.some((item) => item.id === messageId)).toBe(true)
    )
    return client.session(sessionId).items.find((item) => item.id === messageId) as MessageItem
  }
  const item = await question()
  return { fake, client, id, item, question }
}

test("the transcript renders nonmodal options, sends only on submit, and binds the reply to the original question", async () => {
  const { client, id, item } = await setup()
  const send = vi.spyOn(client, "prompt").mockResolvedValue()
  const session = client.session(id)
  const view = render(
    <AssistantTurn
      sessionId={id}
      turn={groupTurns(session)[0]}
      terminals={{}}
      active
      isLast
      error={null}
      interrupted={false}
    />
  )
  expect(view.queryByRole("dialog")).toBeNull()
  expect(view.getByRole("radio", { name: "Local" })).toBeChecked()
  expect(send).not.toHaveBeenCalled()
  expect(client.state.actions).toEqual([])
  fireEvent.click(view.getByRole("radio", { name: "Remote" }))
  fireEvent.click(view.getByRole("button", { name: "Submit answer" }))
  await waitFor(() => expect(send).toHaveBeenCalledOnce())
  expect(send).toHaveBeenCalledWith(id, [
    {
      type: "text",
      text: questionReplyEnvelope({
        questionItemId: asyncQuestionId(item.id, 0),
        question: "Which environment?",
        answer: "Remote"
      }),
      _meta: {
        codex: {
          questionReply: {
            questionItemId: asyncQuestionId(item.id, 0),
            question: "Which environment?",
            answer: "Remote"
          }
        }
      }
    }
  ])
  await waitFor(() => expect(view.queryByRole("button", { name: "Submit answer" })).toBeNull())
  expect(client.session(id).state).toBe("running")
  view.unmount()
})

test("free text survives session switches and failures; duplicate clicks cannot submit twice", async () => {
  const { client, id, item, question } = await setup()
  const other = await client.newSession("/qa/other")
  const otherItem = await question(other, "Other question", null)
  let reject!: (reason: Error) => void
  const send = vi
    .spyOn(client, "prompt")
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        })
    )
    .mockResolvedValue()
  const view = render(<AsyncQuestions sessionId={id} item={item} />)
  fireEvent.change(view.getByRole("textbox"), { target: { value: "Custom\n<details>" } })
  view.rerender(<AsyncQuestions sessionId={other} item={otherItem} />)
  expect(view.getByRole("textbox")).toHaveValue("")
  view.rerender(<AsyncQuestions sessionId={id} item={item} />)
  expect(view.getByRole("textbox")).toHaveValue("Custom\n<details>")
  fireEvent.click(view.getByRole("button", { name: "Submit answer" }))
  fireEvent.click(view.getByRole("button", { name: "Submitting…" }))
  expect(send).toHaveBeenCalledTimes(1)
  view.rerender(<AsyncQuestions sessionId={other} item={otherItem} />)
  await act(async () => {
    reject(new Error("Network unavailable"))
    await Promise.resolve()
  })
  expect(view.queryByRole("alert")).toBeNull()
  view.rerender(<AsyncQuestions sessionId={id} item={item} />)
  expect(view.getByRole("alert")).toHaveTextContent("Network unavailable")
  expect(view.getByRole("textbox")).toHaveValue("Custom\n<details>")
  fireEvent.click(view.getByRole("button", { name: "Submit answer" }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  expect(send.mock.calls.every(([sessionId]) => sessionId === id)).toBe(true)
  view.unmount()
})

test("replay, completed turns, read-only ownership and disconnected sessions cannot send stale answers", async () => {
  const { client, id, item, fake } = await setup()
  const send = vi.spyOn(client, "prompt").mockResolvedValue()
  const view = render(<AsyncQuestions sessionId={id} item={{ ...item, replayed: true }} />)
  expect(view.getByRole("button", { name: "Submit answer" })).toBeDisabled()
  view.rerender(<AsyncQuestions sessionId={id} item={item} />)
  act(() => {
    client.store.setState((state) => ({
      sessions: { ...state.sessions, [id]: { ...state.sessions[id], readOnly: true } }
    }))
  })
  expect(view.getByRole("button", { name: "Submit answer" })).toBeDisabled()
  act(() => {
    client.store.setState((state) => ({
      connection: "disconnected",
      sessions: { ...state.sessions, [id]: { ...state.sessions[id], readOnly: false } }
    }))
  })
  expect(view.getByRole("button", { name: "Submit answer" })).toBeDisabled()
  act(() => {
    client.store.setState({ connection: "ready" })
  })
  fireEvent.change(view.getByRole("textbox"), { target: { value: "Unsent draft" } })
  await act(() =>
    fake.pushUpdate(id, {
      sessionUpdate: "state_update",
      state: "idle",
      stopReason: "end_turn",
      userMessageId: "prompt"
    })
  )
  await waitFor(() => expect(view.getByRole("status")).toHaveTextContent("This turn has ended"))
  expect(view.getByRole("textbox")).toHaveValue("Unsent draft")
  await act(() => fake.pushUpdate(id, { sessionUpdate: "state_update", state: "running" }))
  expect(view.getByRole("button", { name: "Submit answer" })).toBeDisabled()
  expect(send).not.toHaveBeenCalled()
  view.unmount()
})

test("a reply echoed from another client settles the original card, including after history replay", async () => {
  const { client, id, item, fake } = await setup()
  const send = vi.spyOn(client, "prompt").mockResolvedValue()
  const view = render(<AsyncQuestions sessionId={id} item={item} />)
  const reply = {
    questionItemId: asyncQuestionId(item.id, 0),
    question: "Which environment?",
    answer: "Answered elsewhere"
  }
  await act(() =>
    fake.pushUpdate(id, {
      sessionUpdate: "user_message",
      messageId: "other-client",
      content: [{ type: "text", text: reply.answer, _meta: { codex: { questionReply: reply } } }],
      _meta: { codex: { turnId: "turn" } }
    })
  )
  await waitFor(() => expect(view.getByText("Answered elsewhere")).toBeInTheDocument())
  view.rerender(<AsyncQuestions sessionId={id} item={{ ...item, replayed: true }} />)
  expect(view.queryByRole("textbox")).toBeNull()
  expect(send).not.toHaveBeenCalled()
  view.unmount()
})

test("an optimistic reply displays readable content without settling the card before acceptance", async () => {
  const { client, id, item } = await setup()
  const reply = { questionItemId: asyncQuestionId(item.id, 0), question: "Which environment?", answer: "Remote" }
  const pending: MessageItem = {
    id: "pending-reply",
    kind: "user",
    at: Date.now(),
    echo: "pending",
    replayed: false,
    _meta: null,
    content: [{ type: "text", text: questionReplyEnvelope(reply), _meta: { codex: { questionReply: reply } } }]
  }
  client.store.setState((state) => ({
    sessions: { ...state.sessions, [id]: { ...state.sessions[id], items: [...state.sessions[id].items, pending] } }
  }))
  const view = render(
    <>
      <AsyncQuestions sessionId={id} item={item} />
      <UserMessage item={pending} messageTime={null} />
    </>
  )
  expect(view.getByRole("button", { name: "Submit answer" })).toBeEnabled()
  expect(view.container.textContent).not.toContain("send_user_message_question_reply")
  act(() => {
    client.store.setState((state) => ({
      sessions: {
        ...state.sessions,
        [id]: {
          ...state.sessions[id],
          items: [...state.sessions[id].items.slice(0, -1), { ...pending, echo: "acknowledged" }]
        }
      }
    }))
  })
  expect(view.queryByRole("button", { name: "Submit answer" })).toBeNull()
})
