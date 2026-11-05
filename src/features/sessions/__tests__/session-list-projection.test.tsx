import type { SessionRunState } from "@alwith/api"
import { createSession } from "@alwith/module-chat/client"
import { SessionRow } from "@alwith/module-chat/session-list"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { SessionListHostProvider } from "../session-list-host"

await initI18n("en")
const initial = client.state
afterEach(() => {
  cleanup()
  client.store.setState(initial, true)
  vi.restoreAllMocks()
})

function record(state: SessionRunState["state"]): SessionRunState {
  return {
    sessionId: "historical",
    state,
    reusableDraft: false,
    cwd: "/tmp",
    title: "Historical chat",
    owner: "stdio",
    since: 1,
    lastActivityAt: 1,
    version: 1,
    interruption: null,
    tasks: [],
    listeningPorts: [],
    executionId: null,
    executionRole: null
  }
}

test("history stays navigable without activity controls, then follows new activity and Runtime removal", async () => {
  client.applyRunStates([record("idle")], "snapshot")
  const select = vi.fn()
  const stop = vi.spyOn(client, "stopSession").mockResolvedValue()
  const view = render(
    <SessionRow
      sessionRow={{ sessionId: "historical", cwd: "/tmp", title: "Historical chat", updatedAt: null, archived: false }}
      active={false}
      onSelect={select}
    />,
    { wrapper: SessionListHostProvider }
  )
  expect(view.getByText("Historical chat")).toBeInTheDocument()
  expect(view.container.querySelector(".bg-green-500")).toBeNull()
  expect(view.queryByTitle("Stop")).not.toBeInTheDocument()
  fireEvent.click(view.getByText("Historical chat"))
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "historical" }))
  expect(client.state.runStates.historical?.state).toBe("idle")

  await act(() => Promise.try(() => client.applyRunStates([record("running")])))
  expect(view.getByTitle("Stop")).toBeInTheDocument()
  await act(() => Promise.try(() => client.applyRunStates([record("done")])))
  expect(view.container.querySelector(".bg-blue-500")).not.toBeNull()
  await act(() => Promise.try(() => client.applyRunStates([record("idle")])))
  expect(view.container.querySelector(".bg-green-500")).not.toBeNull()
  await act(() => Promise.try(() => fireEvent.click(view.getByTitle("Stop"))))
  expect(stop).toHaveBeenCalledExactlyOnceWith("historical")
  expect(view.getByTitle("Stop")).toBeInTheDocument()
  await act(() => Promise.try(() => client.applyRunStates([])))
  expect(view.getByText("Historical chat")).toBeInTheDocument()
  expect(view.queryByTitle("Stop")).not.toBeInTheDocument()
  expect(view.container.querySelector(".bg-green-500")).toBeNull()
})

test("successfully opening idle history shows activity controls without sending a prompt", async () => {
  client.applyRunStates([record("idle")], "snapshot")
  const view = render(
    <SessionRow
      sessionRow={{ sessionId: "historical", cwd: "/tmp", title: "Historical chat", updatedAt: null, archived: false }}
      active
      onSelect={() => {}}
    />,
    { wrapper: SessionListHostProvider }
  )
  expect(view.queryByTitle("Stop")).not.toBeInTheDocument()
  await act(() =>
    Promise.try(() =>
      client.store.setState({ sessions: { historical: { ...createSession("historical", "/tmp"), attached: true } } })
    )
  )
  expect(view.getByTitle("Stop")).toBeInTheDocument()
  expect(view.container.querySelector(".bg-green-500")).not.toBeNull()
  expect(client.state.runStates.historical?.state).toBe("idle")
})
