import { expect, test } from "bun:test"
import { applyUpdate, createSession } from "@alwith/api"
import { groupTurns } from "../../turns"
import { formatTurnTime } from "../turn-time"

function turnAt(timestamp: unknown, replayed = true) {
  return groupTurns(
    applyUpdate({ ...createSession("time", "/tmp"), restoring: replayed }, {
      sessionUpdate: "agent_message",
      messageId: "answer",
      content: [{ type: "text", text: "answer" }],
      _meta: { codex: { turnStartedAt: timestamp } }
    } as never)
  )[0]
}

test("replayed batches use native time, with Desktop's today and older date formats", () => {
  const today = new Date()
  today.setHours(12, 34, 0, 0)
  expect(formatTurnTime(turnAt(today.getTime()))?.short).toBe(
    new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(today)
  )
  const older = new Date(2024, 0, 2, 3, 4)
  expect(formatTurnTime(turnAt(older.getTime()))).toEqual({
    short: new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(older),
    full: "2024-01-02 03:04"
  })
})

test("history without a native time never displays its replay arrival time", () => {
  for (const invalid of [undefined, null, "123", Number.NaN, Infinity, 9e15]) {
    expect(formatTurnTime(turnAt(invalid))).toBeNull()
  }
  expect(formatTurnTime(turnAt(undefined, false))).not.toBeNull()
})
