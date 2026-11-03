import { createStore } from "@alwith/api/client"
import { expect, test, vi } from "vitest"

import { CodexClient } from "@/agent/client"
import { IMAGE_THREAD_SOURCE } from "@/agent/session-kind"

import { chatHistoryState, chatHistoryStore } from "../chat-history"

test("ordinary history excludes only native image sources without changing the Codex store", () => {
  const client = new CodexClient(
    async () => {
      throw new Error("No process")
    },
    { agentId: "test", launch: { engine: "codex" } }
  )
  const normal = {
    sessionId: "normal-with-images",
    cwd: "/tmp",
    title: "Normal chat",
    updatedAt: null,
    archived: false
  }
  const image = { ...normal, sessionId: "image", threadSource: IMAGE_THREAD_SOURCE }
  const archived = { ...image, sessionId: "archived-image", archived: true }
  const state = { ...client.state, sessionList: [normal, image], archivedSessions: [archived] }
  const store = createStore(state)
  const history = chatHistoryStore(store)
  expect(history.getState().sessionList).toEqual([normal])
  expect(history.getState().archivedSessions).toEqual([])
  expect(store.getState().sessionList).toEqual([normal, image])
  expect(chatHistoryState(state)).toBe(history.getState())
  const changed = vi.fn()
  const stop = history.subscribe(changed)
  store.setState({ sessionList: [image, normal] })
  expect(changed.mock.calls[0]?.[0].sessionList).toEqual([normal])
  expect(changed.mock.calls[0]?.[1]).toBe(chatHistoryState(state))
  const rows = history.getState().sessionList
  store.setState({ connectionError: "unrelated state update" })
  expect(history.getState().sessionList).toBe(rows)
  stop()
})
