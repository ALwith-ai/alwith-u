import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { applyUpdate, createSession, type Session } from "@alwith/api"
import { expect, test } from "vitest"

import { codexMessageError } from "@/agent/codex-extensions"
import { projectHistoryTurns } from "@/agent/history-page"

import { capacityRetryDelay } from "../lib/turn-retry"
import { groupTurns } from "../turns"

function failure(id: string): acp.SessionUpdate {
  return {
    sessionUpdate: "agent_message",
    messageId: `codex-error:${id}`,
    content: [{ type: "text", text: "Selected model is at capacity." }],
    _meta: {
      codex: {
        turnId: id,
        error: {
          message: "Selected model is at capacity.",
          category: "overloaded",
          retryable: true,
          stopReason: "error"
        }
      }
    }
  }
}
function prompt(id: string): acp.SessionUpdate {
  return {
    sessionUpdate: "user_message",
    messageId: `user:${id}`,
    content: [{ type: "text", text: "Do the work" }],
    _meta: { codex: { turnId: id } }
  }
}

test("live and replay retain one error per native turn without treating diagnostics as answers", () => {
  let session = applyUpdate(applyUpdate(createSession("s", "/tmp"), prompt("first")), failure("first"))
  session = applyUpdate(session, {
    sessionUpdate: "state_update",
    state: "idle",
    stopReason: "error",
    error: { code: -32603, message: "Selected model is at capacity." }
  })
  const [live] = groupTurns(session)
  expect(live.errors).toHaveLength(1)
  expect(live.final).toEqual([])
  const replay = projectHistoryTurns("s", "/tmp", null, [
    { turnId: "first", status: "failed", itemsView: "full", updates: [prompt("first"), failure("first")] }
  ])
  const [restored] = groupTurns(replay)
  expect(codexMessageError(restored.errors[0])?.error).toEqual(codexMessageError(live.errors[0])?.error)
  session = applyUpdate(session, prompt("new"))
  session = applyUpdate(session, { sessionUpdate: "state_update", state: "running" })
  expect(session.error).toBeNull()
  expect(groupTurns(session)[0].errors).toHaveLength(1)
})

test("empty-input retry attempts remain in native order and back off until automatic retries stop", () => {
  let session = applyUpdate(applyUpdate(createSession("s", "/tmp"), prompt("first")), failure("first"))
  expect(capacityRetryDelay(groupTurns(session))).toBe(10)
  for (const [index, delay] of [30, 120, 300, null].entries()) {
    session = applyUpdate(session, failure(`retry-${index}`))
    const turns = groupTurns(session)
    expect(turns).toHaveLength(index + 2)
    expect(turns.at(-1)?.user).toBeNull()
    expect(capacityRetryDelay(turns)).toBe(delay)
  }
  session = applyUpdate(session, prompt("fresh"))
  session = applyUpdate(session, failure("fresh"))
  expect(capacityRetryDelay(groupTurns(session))).toBe(10)
})

test("a retry's tool work and final answer follow the original error without copying the user prompt", () => {
  const plan = (turnId: string, label: string): acp.SessionUpdate => ({
    sessionUpdate: "plan_update",
    plan: {
      type: "items",
      planId: `codex-turn-plan:${turnId}`,
      entries: [{ content: label, priority: "medium", status: "pending" }]
    },
    _meta: { codex: { turnId } }
  })
  let session: Session = applyUpdate(
    applyUpdate(applyUpdate(createSession("s", "/tmp"), prompt("first")), plan("first", "Original plan")),
    failure("first")
  )
  session = applyUpdate(session, plan("retry", "Revised plan"))
  session = applyUpdate(session, {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool",
    name: "read_file",
    kind: "read",
    status: "completed",
    _meta: { codex: { turnId: "retry" } }
  })
  session = applyUpdate(session, {
    sessionUpdate: "agent_message",
    messageId: "answer",
    content: [{ type: "text", text: "Done" }],
    _meta: { codex: { turnId: "retry", phase: "final_answer" } }
  })
  const turns = groupTurns(session)
  expect(turns).toHaveLength(2)
  expect(turns[0].errors).toHaveLength(1)
  expect(turns[1].errors).toEqual([])
  expect(turns[0].work.map((entry) => entry.kind)).toEqual(["plan"])
  expect(turns[1].work.map((entry) => entry.kind)).toEqual(["plan", "activity"])
  expect(turns[1].final[0].id).toBe("answer")
  expect(session.items.filter((item) => item.kind === "user")).toHaveLength(1)
})
