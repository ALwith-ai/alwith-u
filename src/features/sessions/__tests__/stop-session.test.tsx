import type { SessionRunState } from "@alwith/api"
import { act, cleanup, fireEvent, render, within } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { projectContext } from "@/agent/__tests__/project-context"
import { SidebarProvider } from "@/components/ui/sidebar"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { SessionSidebar } from "../session-sidebar"
import { useSessionsUiStore } from "../store"

await initI18n("en")
const originalState = client.state
const originalUi = useSessionsUiStore.getState()
afterEach(async () => {
  await act(() => {
    return Promise.try(() => {
      cleanup()
      client.store.setState(originalState, true)
      useSessionsUiStore.setState(originalUi, true)
    })
  })
  vi.restoreAllMocks()
})

test.each(
  (["sessions", "activity"] as const).flatMap((view) =>
    (["running", "requires_action", "idle", "done"] as const).map((state) => ({ view, state }))
  )
)("$view stop closes a $state background session and waits for Runtime removal", async ({ view, state }) => {
  let complete = () => {}
  const close = vi.spyOn(client, "stopSession").mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve
      })
  )
  const cancel = vi.spyOn(client, "cancel")
  const onSelect = vi.fn()
  const records: SessionRunState[] = ["foreground", "background"].map((sessionId) => ({
    sessionId,
    state: sessionId === "background" ? state : "running",
    reusableDraft: false,
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
  }))
  client.store.setState({
    sessionListLoaded: true,
    projectContext: projectContext(),
    sessionList: records.map((record) => ({
      sessionId: record.sessionId,
      cwd: record.cwd,
      title: record.title,
      updatedAt: null,
      archived: false
    }))
  })
  client.applyRunStates(records)
  useSessionsUiStore.setState({ view, projectOpen: new Map([["/tmp", true]]) })
  const screen = render(
    <SidebarProvider>
      <SessionSidebar
        screen="main"
        leadingPage="plugins"
        selectedId="foreground"
        onSelect={onSelect}
        onNewChat={() => {}}
        onNewProjectChat={() => {}}
        onSearch={() => {}}
        onOpenWindow={() => {}}
        onOpenSettings={() => {}}
        onOpenPlugins={() => {}}
        onSwitchScreen={() => {}}
      />
    </SidebarProvider>
  )
  const row = screen.getByText("background").closest('[role="button"]')
  if (!(row instanceof HTMLElement)) throw new Error("Missing background session row")
  const button = within(row).getByTitle("Stop")
  await act(() => Promise.try(() => fireEvent.click(button)))
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute("aria-busy", "true")
  expect(within(button).getByRole("status")).toBeInTheDocument()
  await act(() => Promise.try(() => fireEvent.click(button)))
  expect(close).toHaveBeenCalledExactlyOnceWith("background")
  expect(cancel).not.toHaveBeenCalled()
  expect(onSelect).not.toHaveBeenCalled()
  // The Runtime's next state update remains authoritative; clicking cannot clear other sessions.
  expect(client.state.runStates.foreground?.state).toBe("running")
  expect(client.state.runStates.background?.state).toBe(state)
  await act(() => {
    return Promise.try(() => {
      complete()
      client.applyRunStates(records.filter((record) => record.sessionId !== "background"))
    })
  })
  if (view === "activity") expect(screen.queryByText("background")).not.toBeInTheDocument()
  else expect(within(row).queryByTitle("Stop")).not.toBeInTheDocument()
  expect(screen.getByText("foreground")).toBeInTheDocument()
})
