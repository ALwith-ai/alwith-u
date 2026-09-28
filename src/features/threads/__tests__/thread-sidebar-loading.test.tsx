import { act, cleanup, render } from "@testing-library/react"
import { afterEach, expect, test } from "bun:test"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { SidebarProvider } from "@/components/ui/sidebar"
import { ThreadSidebar } from "../thread-sidebar"

installDom()
await initI18n("en")

const originalState = client.state
afterEach(async () => {
  await act(async () => {
    cleanup()
    client.store.setState(originalState, true)
    await Bun.sleep(0)
  })
})

function showSidebar() {
  return render(
    <SidebarProvider>
      <ThreadSidebar
        screen="main"
        leadingPage="plugins"
        selectedId={null}
        onSelect={() => {}}
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
}

test("the first sidebar frame shows two project-shaped loading rows", async () => {
  client.store.setState({
    connection: "disconnected",
    connectionError: null,
    threadsLoaded: false,
    threadsLoading: false,
    threadsError: null
  })
  const screen = showSidebar()
  const rows = screen.container.querySelectorAll('[data-slot="project-skeleton-row"]')
  expect(rows).toHaveLength(2)
  for (const row of rows) {
    expect(row.classList.contains("h-[var(--navigation-row-height)]")).toBe(true)
    expect(row.querySelector(".lucide-folder-closed")).not.toBeNull()
    expect(row.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2)
  }
  await act(async () => {
    await Bun.sleep(0)
  })
})

test("a failed initial list offers retry instead of a permanent skeleton", async () => {
  client.store.setState({
    connection: "ready",
    threadsLoaded: false,
    threadsLoading: false,
    threadsError: "Unavailable"
  })
  const screen = showSidebar()
  expect(screen.container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0)
  expect(screen.getByText("Unavailable")).toBeTruthy()
  expect(screen.getByRole("button", { name: /retry|重试/i })).toBeTruthy()
  await act(async () => {
    await Bun.sleep(0)
  })
})
