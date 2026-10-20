import type { SessionRunState } from "@alwith/api"
import { expect, test } from "vitest"

import { type AppState, CodexClient } from "@/agent/client"

import { recentMainActivity } from "../recent-main-activity"

function record(sessionId: string, lastActivityAt: number): SessionRunState {
  return {
    sessionId,
    lastActivityAt,
    version: 1,
    interruption: null,
    cwd: "/tmp",
    title: sessionId,
    owner: "stdio",
    since: 0,
    state: "idle",
    reusableDraft: false,
    tasks: [],
    listeningPorts: [],
    executionId: null,
    executionRole: null
  }
}

function state(): AppState {
  return new CodexClient(
    async () => {
      throw new Error("No connection needed")
    },
    {
      agentId: "codex",
      launch: { engine: "codex" }
    }
  ).state
}

test("selects the most recently active main conversation after a handoff", () => {
  const current = state()
  current.runStates = Object.fromEntries(
    [
      record("older", 10),
      record("recent", 30),
      record("moving", 50),
      record("floating", 60),
      { ...record("draft", 70), reusableDraft: true },
      record("local-draft", 80)
    ].map((record) => [record.sessionId, record])
  )
  current.sessionWindows = { floating: "chat", older: "main", recent: "main" }
  current.draftSessions = { "local-draft": "main" }
  expect(recentMainActivity(current, "moving")?.sessionId).toBe("recent")
})

test("returns an empty destination when no eligible activity remains", () => {
  const current = state()
  current.runStates = { moving: record("moving", 10), floating: record("floating", 20) }
  current.sessionWindows = { floating: "chat" }
  expect(recentMainActivity(current, "moving")).toBeNull()
})

test("uses Runtime membership rather than cached history or loaded sessions", () => {
  const current = state()
  current.threads = [
    { sessionId: "history", cwd: "/tmp", title: "History", updatedAt: new Date().toISOString(), archived: false }
  ]
  current.runStates = { active: record("active", 1) }
  expect(recentMainActivity(current, null)?.sessionId).toBe("active")
  current.runStates = {}
  expect(recentMainActivity(current, null)).toBeNull()
})
