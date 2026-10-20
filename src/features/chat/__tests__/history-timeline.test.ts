import { applyUpdate, createSession } from "@alwith/api"
import { expect, test } from "vitest"
import type { HistoryNavigationState } from "@/agent/history-navigation"
import { historyTimeline } from "../history-timeline"
import { groupTurns } from "../turns"

test("keeps mounted native turn identities when the summary index arrives and a skeleton hydrates", () => {
  const session = applyUpdate(createSession("s", "/"), {
    sessionUpdate: "user_message",
    messageId: "latest-user",
    content: [{ type: "text", text: "Latest" }],
    _meta: { codex: { turnId: "latest" } }
  })
  const turns = groupTurns(session)
  const navigation: HistoryNavigationState = {
    turns: [{ turnId: "older" }, { turnId: "latest" }],
    loadedTurnIds: ["latest"],
    loading: false,
    complete: true,
    error: null,
    previews: {},
    turnErrors: {}
  }
  const before = historyTimeline(turns)
  const indexed = historyTimeline(turns, navigation)
  expect(indexed[1].turnKey).toBe(before[0].turnKey)
  expect(indexed[0]).toMatchObject({ turnKey: "history:older", placeholder: true })
  const hydrated = applyUpdate(session, {
    sessionUpdate: "user_message",
    messageId: "older-user",
    content: [{ type: "text", text: "Older" }],
    _meta: { codex: { turnId: "older" } }
  })
  const after = historyTimeline(groupTurns(hydrated), { ...navigation, loadedTurnIds: ["older", "latest"] })
  expect(after[0].turnKey).toBe(indexed[0].turnKey)
  expect(after[0].placeholder).toBeUndefined()
  expect(after[0].aliases).toEqual(["turn:user:older-user"])
})
