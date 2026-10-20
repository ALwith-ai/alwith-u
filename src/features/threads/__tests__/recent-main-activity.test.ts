import { createSession, type SessionRunState } from "@alwith/api"
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
  current.sessions = Object.fromEntries(
    ["older", "recent", "floating"].map((id) => [id, { ...createSession(id, "/tmp"), attached: true }])
  )
  current.draftSessions = { "local-draft": "main" }
  expect(recentMainActivity(current, "moving")?.sessionId).toBe("recent")
})

test("returns an empty destination when no eligible activity remains", () => {
  const current = state()
  current.runStates = { moving: record("moving", 10), floating: record("floating", 20) }
  current.sessionWindows = { floating: "chat" }
  expect(recentMainActivity(current, "moving")).toBeNull()
})

test("ignores other clients and disconnected sessions even when their Runtime activity is newer", () => {
  const current = state()
  current.threads = [
    { sessionId: "history", cwd: "/tmp", title: "History", updatedAt: new Date().toISOString(), archived: false }
  ]
  current.runStates = {
    active: record("active", 1),
    external: record("external", 2),
    disconnected: record("disconnected", 3)
  }
  current.sessions = {
    active: { ...createSession("active", "/tmp"), attached: true },
    disconnected: createSession("disconnected", "/tmp")
  }
  current.sessionWindows = { active: "main", disconnected: "main" }
  expect(recentMainActivity(current, null)?.sessionId).toBe("active")
  delete current.runStates.active
  expect(recentMainActivity(current, null)).toBeNull()
  current.runStates = {}
  expect(recentMainActivity(current, null)).toBeNull()
})
