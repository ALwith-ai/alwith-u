import { acknowledgePrompt, addPrompt, applyUpdate, createSession, type Session } from "@alwith/api"
import { describe, expect, test } from "vitest"

import { must } from "@/lib/__tests__/must"

import { activeTurnKey, continuesTurn, groupTurns, turnPresentation } from "../turns"

const text = (messageId: string, text: string, _meta?: Record<string, unknown>) =>
  ({
    sessionUpdate: "agent_message_chunk",
    messageId,
    content: { type: "text", text },
    ...(_meta ? { _meta } : {})
  }) as never
const idle = { sessionUpdate: "state_update", state: "idle", stopReason: "end_turn" } as never

function feed(session: Session, ...updates: unknown[]): Session {
  return updates.reduce<Session>((current, update) => applyUpdate(current, update as never), session)
}

/**
 * A prompt the agent has taken: on screen under a local id, claimed by the receipt, then echoed
 * as `user_message` — only an echoed prompt owns the output that streams after it.
 */
function sent(session: Session, text: string, localId: string, messageId: string): Session {
  const content = [{ type: "text" as const, text }]
  const claimed = acknowledgePrompt(addPrompt(session, content, localId), localId, messageId)
  return feed(claimed, { sessionUpdate: "user_message", messageId, content })
}

describe("groupTurns over @alwith/api", () => {
  test("sparse native history does not attribute an orphan answer across an unloaded gap", () => {
    const session = feed(
      createSession("s", "/"),
      {
        sessionUpdate: "user_message",
        messageId: "u",
        content: [{ type: "text", text: "old" }],
        _meta: { codex: { turnId: "old" } }
      },
      text("a", "later", { codex: { turnId: "later" } })
    )
    const turns = groupTurns(session, [], [{ turnId: "old" }, { turnId: "missing" }, { turnId: "later" }])
    expect(turns.map((turn) => turn.user?.id ?? null)).toEqual(["u", null])
    expect(turns[0].final).toHaveLength(0)
    expect(turns[1].final[0].id).toBe("a")
  })
  test("a local prompt starts the turn on screen; the receipt renames it, the echo keeps the key", () => {
    let session = addPrompt(createSession("s", "/"), [{ type: "text", text: "go" }], "local")
    expect(groupTurns(session).map((turn) => turn.key)).toEqual(["turn:user:local"])
    session = acknowledgePrompt(session, "local", "u-1")
    expect(groupTurns(session).map((turn) => turn.key)).toEqual(["turn:user:u-1"])
    session = feed(session, { sessionUpdate: "user_message", messageId: "u-1", content: [] })
    const [turn] = groupTurns(session)
    expect(turn?.key).toBe("turn:user:u-1")
    expect(turn?.user?.content).toEqual([{ type: "text", text: "go" }])
  })

  test("final answer vs commentary is Codex's phase; usage-free structure otherwise comes from the package", () => {
    let session = sent(createSession("s", "/"), "go", "local", "u")
    session = feed(
      session,
      text("c", "thinking aloud", { codex: { phase: "commentary" } }),
      { sessionUpdate: "tool_call_update", toolCallId: "t", name: "apply_patch", kind: "edit", status: "completed" },
      text("f", "done", { codex: { phase: "final_answer" } })
    )
    const [turn] = groupTurns(session)
    expect(turn?.work.map((entry) => entry.kind)).toEqual(["text", "activity"])
    expect(turn?.final.map((item) => item.id)).toEqual(["f"])
    expect(turn?.edits.map((item) => item.id)).toEqual(["t"])
  })

  test("endedAt is the idle frame while a finished turn, the latest arrival while it runs", () => {
    let session = sent(createSession("s", "/"), "go", "local", "u")
    session = feed(session, text("a", "…"))
    const running = groupTurns(session)[0]
    expect(running.endedAt).toBe(must(running.items.at(-1), "the running item").at)
    session = feed(session, idle)
    const finished = groupTurns(session)[0]
    expect(finished.endedAt).toBeGreaterThan(running.endedAt)
  })

  test("untouched turns keep their object identity across updates; the streaming one does not", () => {
    let session = sent(createSession("s", "/"), "one", "l1", "u1")
    session = feed(
      session,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "t",
        name: "exec_command",
        kind: "execute",
        status: "completed"
      },
      text("a", "1"),
      idle
    )
    session = sent(session, "two", "l2", "u2")
    const before = groupTurns(session)
    session = feed(session, text("b", "2"))
    const after = groupTurns(session, before)
    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    session = feed(session, { sessionUpdate: "tool_call_update", toolCallId: "t", rawOutput: "late output" })
    const patched = groupTurns(session, after)
    expect(patched[0]).not.toBe(after[0])
    expect(patched[1]).toBe(after[1])
  })

  test("history that starts with the agent's words is a turn without a user", () => {
    const session = feed(createSession("s", "/"), text("a", "hello"))
    const [turn] = groupTurns(session)
    expect(turn?.user).toBeNull()
    expect(turn?.key).toBe("turn:assistant:a")
    expect(turn?.replayed).toBe(false)
  })
})

test.each([false, true])(
  "MCP startup diagnostics stay out of turns without changing source items (replayed=%s)",
  (replayed) => {
    const original = feed(createSession("mcp", "/"), {
      sessionUpdate: "tool_call_update",
      toolCallId: "mcp-startup:yup-drive",
      name: "mcp_startup",
      title: "Start MCP server yup-drive",
      status: "failed",
      content: [{ type: "content", content: { type: "text", text: "HTTP 404" } }]
    })
    const session = { ...original, items: original.items.map((item) => ({ ...item, replayed })) }
    expect(groupTurns(session)).toEqual([])
    expect(session.items).toHaveLength(1)
    expect(session.items[0]).toMatchObject({ name: "mcp_startup", status: "failed", replayed })
    const prompted = sent(session, "hello", "local", "user")
    const mixed = feed(
      prompted,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "late-startup",
        name: "mcp_startup",
        status: "failed"
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "ordinary-error",
        name: "read_file",
        status: "failed"
      },
      text("answer", "Hello")
    )
    const turns = groupTurns(mixed)
    expect(turns).toHaveLength(1)
    expect(turns[0].items.map((item) => item.id)).toEqual(["user", "ordinary-error", "answer"])
    expect(turns[0].work).toMatchObject([{ kind: "activity", items: [{ id: "ordinary-error", status: "failed" }] }])
  }
)

test("steering continues a native turn while a later native turn does not", () => {
  const user = (id: string, turnId: string) => ({
    sessionUpdate: "user_message",
    messageId: id,
    content: [{ type: "text", text: id }],
    _meta: { codex: { turnId } }
  })
  const session = feed(
    createSession("steer", "/"),
    user("first", "one"),
    text("work", "Working", { codex: { phase: "commentary", turnId: "one" } }),
    user("steering", "one"),
    text("answer", "Done", { codex: { phase: "final_answer", turnId: "one" } }),
    user("next", "two")
  )
  const turns = groupTurns(session)
  expect(continuesTurn(session, turns[0], turns[1])).toBe(true)
  expect(continuesTurn(session, turns[1], turns[2])).toBe(false)
})

test("a pending steer does not complete the current work", () => {
  let session = sent(createSession("pending-steer", "/"), "start", "local", "first")
  session = feed(
    session,
    { sessionUpdate: "state_update", state: "running" },
    text("working", "Working", { codex: { phase: "commentary" } })
  )
  session = addPrompt(session, [{ type: "text", text: "also check this" }], "steer")
  const turns = groupTurns(session)
  expect(continuesTurn(session, turns[0], turns[1])).toBe(true)
  expect(continuesTurn({ ...session, state: "idle" }, turns[0], turns[1])).toBe(false)
})

test.each(["commentary", "final_answer"])(
  "steering keeps %s updates on their owner until new output arrives",
  (phase) => {
    const user = (id: string) => ({
      sessionUpdate: "user_message",
      messageId: id,
      content: [{ type: "text", text: id }],
      _meta: { codex: { turnId: "native" } }
    })
    let session = feed(
      createSession("steer-owner", "/"),
      user("first"),
      { sessionUpdate: "state_update", state: "running" },
      text("output", "Starting", { codex: { phase, turnId: "native" } })
    )
    session = addPrompt(session, [{ type: "text", text: "also" }], "local")
    expect(activeTurnKey(session, groupTurns(session))).toBe("turn:user:first")
    session = acknowledgePrompt(session, "local", "steer")
    expect(activeTurnKey(session, groupTurns(session))).toBe("turn:user:first")
    session = feed(session, user("steer"), text("output", " still streaming", { codex: { phase, turnId: "native" } }))
    expect(activeTurnKey(session, groupTurns(session))).toBe("turn:user:first")
    session = feed(
      session,
      text("next-output", "Using the addition", { codex: { phase: "commentary", turnId: "native" } })
    )
    expect(activeTurnKey(session, groupTurns(session))).toBe("turn:user:steer")
    session = feed(session, idle)
    expect(activeTurnKey(session, groupTurns(session))).toBeUndefined()
  }
)

test("a new request after completion owns its placeholder", () => {
  let session = sent(createSession("new-owner", "/"), "first", "local", "first")
  session = feed(session, text("answer", "Done"), idle)
  session = feed(addPrompt(session, [{ type: "text", text: "next" }], "next"), {
    sessionUpdate: "state_update",
    state: "running"
  })
  expect(activeTurnKey(session, groupTurns(session))).toBe("turn:user:next")
})

test("an unanswered steer keeps the completion summary with the last actual output", () => {
  let session = feed(
    createSession("steer-summary", "/"),
    { sessionUpdate: "user_message", messageId: "first", content: [], _meta: { codex: { turnId: "native" } } },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "edit",
      kind: "edit",
      status: "completed",
      _meta: { codex: { turnId: "native" } }
    },
    text("answer", "Done", { codex: { turnId: "native", phase: "final_answer" } }),
    { sessionUpdate: "user_message", messageId: "steer", content: [], _meta: { codex: { turnId: "native" } } },
    idle
  )
  let turns = groupTurns(session)
  expect(turnPresentation(session, turns, 0).continued).toBe(false)
  expect(turnPresentation(session, turns, 0).edits.map((item) => item.id)).toEqual(["edit"])
  expect(turnPresentation(session, turns, 1).continued).toBe(true)
  session = feed(session, text("followup", "Also done", { codex: { turnId: "native", phase: "final_answer" } }))
  turns = groupTurns(session)
  expect(turnPresentation(session, turns, 0).continued).toBe(true)
  expect(turnPresentation(session, turns, 1).edits.map((item) => item.id)).toEqual(["edit"])
})

test("unphased intermediate speech stays ahead of tools while explicit final answers stay final", () => {
  const session = feed(
    createSession("legacy-phase", "/"),
    text("intro", "I will inspect this"),
    { sessionUpdate: "tool_call_update", toolCallId: "read", name: "read_file", kind: "read", status: "completed" },
    text("final", "The result", { codex: { phase: "final_answer" } })
  )
  const [turn] = groupTurns(session)
  expect(turn.work.map((entry) => entry.kind)).toEqual(["text", "activity"])
  expect(turn.final.map((item) => item.id)).toEqual(["final"])
})
