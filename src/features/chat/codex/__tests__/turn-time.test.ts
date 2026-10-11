import { addPrompt, applyUpdate, createSession } from "@alwith/api"
import { expect, test } from "vitest"
import { groupTurns, turnTiming } from "../../turns"
import { formatTurnTime } from "../turn-time"

function timedTurn(meta: Record<string, unknown>, replayed = true) {
  let session = createSession("time", "/tmp")
  session = applyUpdate({ ...session, restoring: replayed }, {
    sessionUpdate: "user_message",
    messageId: "user",
    content: [{ type: "text", text: "hello" }],
    _meta: { codex: meta }
  } as never)
  session = applyUpdate(session, {
    sessionUpdate: "agent_message",
    messageId: "answer",
    content: [{ type: "text", text: "answer" }],
    _meta: { codex: { ...meta, phase: "final_answer" } }
  } as never)
  return groupTurns(session)[0]
}

test("user send and assistant completion remain distinct across a minute boundary", () => {
  const sent = new Date(2024, 0, 2, 20, 20, 43).getTime()
  const completed = new Date(2024, 0, 2, 20, 21, 19).getTime()
  const turn = timedTurn({ messageSentAt: sent, turnStartedAt: sent, turnCompletedAt: completed, historyReplay: true })
  expect(formatTurnTime(turn, "user")?.full).toBe("2024-01-02 20:20")
  expect(formatTurnTime(turn, "assistant")?.full).toBe("2024-01-02 20:21")
})

test("live assistant uses item completion; history uses persisted turn completion", () => {
  const turn = timedTurn(
    {
      messageCompletedAt: new Date(2024, 0, 2, 20, 21).getTime(),
      turnCompletedAt: new Date(2024, 0, 2, 20, 22).getTime()
    },
    false
  )
  expect(formatTurnTime(turn, "assistant")?.full).toBe("2024-01-02 20:21")
})

test("missing or invalid history timestamps never display arrival or turn-start time", () => {
  for (const invalid of [undefined, null, "123", Number.NaN, Infinity, 9e15]) {
    const turn = timedTurn(
      { messageSentAt: invalid, turnCompletedAt: invalid, turnStartedAt: 123000, historyReplay: true },
      false
    )
    expect(formatTurnTime(turn, "user")).toBeNull()
    expect(formatTurnTime(turn, "assistant")).toBeNull()
  }
})

test("a locally pending user message displays its recorded send time", () => {
  const session = addPrompt(createSession("pending", "/tmp"), [{ type: "text", text: "hi" }], "u")
  expect(formatTurnTime(groupTurns(session)[0], "user")).not.toBeNull()
  expect(formatTurnTime(groupTurns(session)[0], "assistant")).toBeNull()
})

test("native work duration wins over total; total and unknown are explicitly different", () => {
  expect(turnTiming(timedTurn({ workDurationMs: 34000, turnDurationMs: 36284 }))).toMatchObject({
    durationMs: 34000,
    durationKind: "work"
  })
  expect(turnTiming(timedTurn({ historyReplay: true, turnDurationMs: 36284 }))).toMatchObject({
    durationMs: 36284,
    durationKind: "total"
  })
  expect(turnTiming(timedTurn({ historyReplay: true })).durationMs).toBeUndefined()
})
