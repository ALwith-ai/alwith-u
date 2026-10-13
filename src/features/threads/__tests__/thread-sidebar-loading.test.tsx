import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { SidebarProvider } from "@/components/ui/sidebar"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { must } from "@/lib/__tests__/must"
import { useThreadsUiStore } from "../store"
import { ThreadSidebar } from "../thread-sidebar"

await initI18n("en")

const originalState = client.state
afterEach(async () => {
  await act(async () => {
    cleanup()
    client.store.setState(originalState, true)
    await new Promise(resolve => setTimeout(resolve, 0))
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
    await new Promise(resolve => setTimeout(resolve, 0))
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
    await new Promise(resolve => setTimeout(resolve, 0))
  })
})

test("empty quick chats stays first and collapsed without a project hover card", () => {
  client.store.setState({ threadsLoaded: true, threads: [] })
  const view = showSidebar()
  const quick = view.getByRole("button", { name: "Quick chats" })
  expect(quick).toHaveAttribute("aria-expanded", "false")
  expect(quick.closest('[data-slot="popover-trigger"]')).toBeNull()
  const groups = view.getAllByRole("button").filter(button => button.hasAttribute("aria-expanded"))
  expect(groups[0]).toBe(quick)
})

test("each group reveals 100 rows at a time from memory and remembers its expansion", async () => {
  const { useThreadsUiStore } = await import("../store")
  const originalUi = useThreadsUiStore.getState()
  const list = vi.spyOn(client, "listThreads")
  try {
    client.store.setState({
      threadsLoaded: true,
      threads: Array.from({ length: 205 }, (_, index) => ({
        sessionId: String(index),
        cwd: "/Users/mac/Documents/Codex",
        title: `Chat ${index}`,
        updatedAt: null,
        archived: false
      }))
    })
    const view = showSidebar()
    expect(view.container.querySelectorAll("[data-session-id]")).toHaveLength(0)
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Quick chats" })))
    expect(view.container.querySelector('[data-slot="virtual-thread-rows"]')).toHaveAttribute("data-count", "100")
    expect(view.container.querySelectorAll("[data-session-id]").length).toBeLessThan(30)
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Load more" })))
    expect(view.container.querySelector('[data-slot="virtual-thread-rows"]')).toHaveAttribute("data-count", "200")
    expect(view.container.querySelectorAll("[data-session-id]").length).toBeLessThan(30)
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Quick chats" })))
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Quick chats" })))
    expect(view.container.querySelector('[data-slot="virtual-thread-rows"]')).toHaveAttribute("data-count", "200")
    expect(view.container.querySelectorAll("[data-session-id]").length).toBeLessThan(30)
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Load more" })))
    expect(view.container.querySelector('[data-slot="virtual-thread-rows"]')).toHaveAttribute("data-count", "205")
    expect(view.container.querySelectorAll("[data-session-id]").length).toBeLessThan(30)
    expect(view.queryByRole("button", { name: "Load more" })).toBeNull()
    expect(list).not.toHaveBeenCalled()
  } finally {
    list.mockRestore()
    await act(async () => useThreadsUiStore.setState(originalUi, true))
  }
}, 20_000)

test("group expansion, load more and collapse update the scrollbar without scrolling or resizing the viewport", async () => {
  const originalUi = useThreadsUiStore.getState()
  const observers = new Map<ResizeObserverCallback, Set<Element>>()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private elements = new Set<Element>()
      constructor(private callback: ResizeObserverCallback) {
        observers.set(callback, this.elements)
      }
      observe(element: Element) {
        this.elements.add(element)
      }
      unobserve(element: Element) {
        this.elements.delete(element)
      }
      disconnect() {
        observers.delete(this.callback)
      }
    }
  )
  try {
    useThreadsUiStore.setState({ projectOpen: new Map(), revealed: new Map() })
    client.store.setState({
      threadsLoaded: true,
      threadsError: null,
      threads: Array.from({ length: 205 }, (_, index) => ({
        sessionId: String(index),
        cwd: "/project",
        title: `Chat ${index}`,
        updatedAt: null,
        archived: false
      }))
    })
    const view = showSidebar()
    const viewport = must(view.container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]'))
    const content = must(viewport.firstElementChild)
    let contentHeight = 100
    Object.defineProperties(viewport, {
      clientHeight: { value: 320 },
      clientWidth: { value: 240 },
      scrollWidth: { value: 240 },
      scrollHeight: { get: () => contentHeight }
    })
    const deliverResize = async (target: Element) => {
      await act(async () => {
        for (const [callback, elements] of observers) {
          if (elements.has(target)) callback([], {} as ResizeObserver)
        }
        await new Promise(resolve => requestAnimationFrame(resolve))
      })
    }
    // Deliver initial measurements, as the browser does when observation starts.
    await deliverResize(viewport)
    await deliverResize(content)
    expect(view.container.querySelector('[data-slot="scroll-area-scrollbar"]')).toBeNull()

    await act(async () => fireEvent.click(view.getByRole("button", { name: "project" })))
    contentHeight = 3300
    await deliverResize(content)
    const scrollbar = must(view.container.querySelector<HTMLElement>('[data-slot="scroll-area-scrollbar"]'))
    Object.defineProperty(scrollbar, "offsetHeight", { value: 320 })
    await deliverResize(content)
    const expandedThumb = Number.parseFloat(scrollbar.style.getPropertyValue("--scroll-area-thumb-height"))
    expect(expandedThumb).toBeGreaterThan(20)

    await act(async () => fireEvent.click(view.getByRole("button", { name: "Load more" })))
    contentHeight = 6500
    await deliverResize(content)
    expect(Number.parseFloat(scrollbar.style.getPropertyValue("--scroll-area-thumb-height"))).toBeLessThan(
      expandedThumb
    )

    await act(async () => fireEvent.click(view.getByRole("button", { name: "project" })))
    contentHeight = 100
    await deliverResize(content)
    expect(view.container.querySelector('[data-slot="scroll-area-scrollbar"]')).toBeNull()
    expect(viewport.scrollTop).toBe(0)
  } finally {
    cleanup()
    useThreadsUiStore.setState(originalUi, true)
    vi.unstubAllGlobals()
  }
}, 20_000)
