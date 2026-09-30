import { describe, expect, test } from "bun:test"
import { acknowledgePrompt, addPrompt, applyUpdate, createSession, type Session } from "@alwith/api"
import { must } from "@/lib/__tests__/must"
import { groupTurns } from "../turns"

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
  test("a local prompt starts the turn on screen; the receipt renames it, the echo keeps the key", () => {
    let session = addPrompt(createSession("s", "/"), [{ type: "text", text: "go" }], "local")
    expect(groupTurns(session).map(turn => turn.key)).toEqual(["turn:user:local"])
    session = acknowledgePrompt(session, "local", "u-1")
    expect(groupTurns(session).map(turn => turn.key)).toEqual(["turn:user:u-1"])
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
    expect(turn?.work.map(entry => entry.kind)).toEqual(["text", "activity"])
    expect(turn?.final.map(item => item.id)).toEqual(["f"])
    expect(turn?.edits.map(item => item.id)).toEqual(["t"])
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
