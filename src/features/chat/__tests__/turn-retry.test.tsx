import type { SessionUpdate } from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { applyUpdate, createSession, type Session } from "@alwith/module-chat/client"
import { act, cleanup, fireEvent, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { projectTurnRetry } from "@/lib/turn-retry"

import { renderTimeline } from "./timeline-host"

await initI18n("en")
const original = client.state
afterEach(() => {
  cleanup()
  client.store.setState(original, true)
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function update(session: Session, frame: SessionUpdate) {
  return projectTurnRetry(session, applyUpdate(session, frame), frame)
}

function start() {
  return update(
    { ...createSession("session", "/project"), state: "running", attached: true },
    {
      sessionUpdate: "user_message",
      messageId: "prompt",
      content: [{ type: "text", text: "Hello" }],
      _meta: { codex: { turnId: "turn" } }
    }
  )
}

function warning(info: unknown, progress: string, turnId = "turn"): SessionUpdate {
  return {
    sessionUpdate: "session_info_update",
    _meta: {
      codex: { error: { willRetry: true, turnId, message: `Reconnecting... ${progress}`, codexErrorInfo: info } }
    }
  }
}

test.each([
  [{ responseStreamDisconnected: { httpStatusCode: 429 } }, "Server overloaded, reconnecting"],
  ["policyCapacityUnavailable", "Server overloaded, reconnecting"],
  ["serverOverloaded", "Server overloaded, reconnecting"],
  [{ httpConnectionFailed: { httpStatusCode: 429 } }, "Reconnecting..."],
  [{ responseStreamDisconnected: { httpStatusCode: 503 } }, "Reconnecting..."]
])("projects reported retry attempts and clears them when content resumes (%j)", async (info, label) => {
  const session = start()
  const silent = renderTimeline(session)
  expect(screen.queryByText(/reconnecting/i)).toBeNull()
  silent.unmount()
  let next = update(session, warning(info, "1/5"))
  const first = renderTimeline(next)
  expect(await screen.findByText(`${label} 1/5`)).toBeVisible()
  first.unmount()
  const secondWarning = warning(info, "2/5")
  next = update(next, secondWarning)
  next = update(next, warning("serverOverloaded", "3/5", "another-turn"))
  const second = renderTimeline(next)
  expect(await screen.findByText(`${label} 2/5`)).toBeVisible()
  second.unmount()
  next = update(next, secondWarning)
  next = update(next, {
    sessionUpdate: "agent_message_chunk",
    messageId: "answer",
    content: { type: "text", text: "Recovered" },
    _meta: { codex: { turnId: "turn", phase: "final_answer" } }
  })
  next = update(next, secondWarning)
  renderTimeline(next)
  expect(await screen.findByText("Recovered")).toBeVisible()
  expect(screen.queryByText(/reconnecting/i)).toBeNull()
})

test("capacity failure offers one manual retry and never submits on a timer", async () => {
  vi.useFakeTimers()
  const retry = vi.spyOn(client, "retrySession").mockResolvedValue()
  client.store.setState({
    connection: "ready",
    agent: {
      ...original.agent!,
      capabilities: { _meta: { codex: { sessionRetry: { version: 1 } } } }
    }
  })
  const failure = { message: "Model at capacity", kind: "overloaded", actions: ["retry"] }
  const session = update(start(), {
    sessionUpdate: "agent_message",
    messageId: "failed",
    content: [{ type: "text", text: failure.message }],
    _meta: { codex: { turnId: "turn", error: failure } }
  })
  renderTimeline({ ...session, state: "idle", lastStopReason: "error" })
  expect(screen.getByRole("alert")).toHaveTextContent(failure.message)
  const button = screen.getByRole("button", { name: "Retry" })
  await act(() => vi.advanceTimersByTime(391_000))
  expect(retry).not.toHaveBeenCalled()
  await act(async () => {
    fireEvent.click(button)
  })
  expect(retry).toHaveBeenCalledExactlyOnceWith("session", "turn", "manual")
})
