import type { SessionRunState } from "@alwith/api"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { SessionStatusMenu } from "../session-status-menu"

await initI18n("en")
const original = client.state
afterEach(() => {
  cleanup()
  client.store.setState(original, true)
})

function record(sessionId: string, reusableDraft = false): SessionRunState {
  return {
    sessionId,
    reusableDraft,
    state: "running",
    cwd: "/tmp",
    title: sessionId,
    owner: "stdio",
    since: 0,
    lastActivityAt: 0,
    version: 1,
    interruption: null,
    tasks: [],
    listeningPorts: [],
    executionId: null,
    executionRole: null
  }
}

test("the workspace toolbar renders without a session list host and navigates Runtime sessions", async () => {
  client.store.setState({
    runStates: { active: record("active"), owned: record("owned", true), foreign: record("foreign", true) },
    sessionList: [],
    draftSessions: { owned: "main" }
  })
  const select = vi.fn()
  const view = render(<SessionStatusMenu onSelect={select} />)
  expect(view.getByRole("button", { name: "Running: 2" })).toBeVisible()
  expect(view.getByRole("button", { name: "Idle: 0" })).toBeVisible()
  await act(() => Promise.resolve(fireEvent.click(view.getByRole("button", { name: "Running: 2" }))))
  expect(view.queryByRole("menuitem", { name: "foreign" })).toBeNull()
  await act(() => Promise.resolve(fireEvent.click(view.getByRole("menuitem", { name: "active" }))))
  expect(select).toHaveBeenCalledExactlyOnceWith({
    sessionId: "active",
    cwd: "/tmp",
    title: "active",
    updatedAt: null,
    archived: false
  })
})
