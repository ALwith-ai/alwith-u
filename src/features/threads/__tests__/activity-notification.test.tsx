import type { SessionRunState } from "@alwith/api"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { SidebarProvider } from "@/components/ui/sidebar"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { useThreadsUiStore } from "../store"
import { ThreadSidebar } from "../thread-sidebar"

await initI18n("en")
const originalState = client.state
const originalUi = useThreadsUiStore.getState()
afterEach(async () => {
  await act(async () => {
    cleanup()
    client.store.setState(originalState, true)
    useThreadsUiStore.setState(originalUi, true)
  })
  vi.restoreAllMocks()
})

test.each(["done", "requires_action", "running", "idle"] as const)(
  "activity badge acknowledges %s and reappears for new events",
  async (state) => {
    const onSelect = vi.fn()
    const records: SessionRunState[] = ["background"].map((sessionId) => ({
      sessionId,
      state,
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
    client.applyRunStates(records)
    const screen = render(
      <SidebarProvider>
        <ThreadSidebar
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
          onOpenExtensions={() => {}}
          onSwitchScreen={() => {}}
        />
      </SidebarProvider>
    )
    const activity = screen.getByRole("tab", { name: "Activity" })
    const badge = () => activity.querySelector("[data-activity-notification]")
    if (state === "running" || state === "idle") {
      expect(badge()).not.toBeInTheDocument()
      return
    }
    expect(badge()).toBeInTheDocument()
    await act(async () => fireEvent.click(activity))
    expect(badge()).not.toBeInTheDocument()
    expect(client.state.runStates.background?.state).toBe(state)
    act(() => client.applyRunStates(records.map((record) => ({ ...record, version: 2, since: 50 }))))
    expect(badge()).not.toBeInTheDocument()
    await act(async () => fireEvent.click(screen.getByRole("tab", { name: "Chats" })))
    expect(badge()).not.toBeInTheDocument()
    act(() =>
      client.applyRunStates(
        records.map((record) => ({
          ...record,
          version: 3,
          since: 50,
          title: "Renamed"
        }))
      )
    )
    expect(badge()).not.toBeInTheDocument()
    act(() => client.applyRunStates(records.map((record) => ({ ...record, version: 4, since: 100 }))))
    expect(badge()).toBeInTheDocument()
    act(() => client.applyRunStates([]))
    expect(badge()).not.toBeInTheDocument()
  }
)
