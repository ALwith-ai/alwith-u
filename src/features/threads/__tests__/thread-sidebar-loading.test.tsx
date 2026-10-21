import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { SidebarProvider } from "@/components/ui/sidebar"
import { must } from "@/lib/__tests__/must"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { useThreadsUiStore } from "../store"
import { ThreadSidebar } from "../thread-sidebar"

await initI18n("en")

const originalState = client.state
afterEach(async () => {
  await act(async () => {
    cleanup()
    client.store.setState(originalState, true)
    await new Promise((resolve) => setTimeout(resolve, 0))
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

test("the sidebar shows loading rows until the initial list completes, then keeps quick chats during refresh", async () => {
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
  expect(screen.queryByRole("button", { name: "Quick chats" })).toBeNull()
  for (const row of rows) {
    expect(row.classList.contains("h-[var(--navigation-row-height)]")).toBe(true)
    expect(row.querySelector(".lucide-folder-closed")).not.toBeNull()
    expect(row.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2)
  }
  await act(() => {
    return Promise.try(() => {
      client.store.setState({ connection: "ready", threadsLoading: true })
    })
  })
  expect(screen.container.querySelectorAll('[data-slot="project-skeleton-row"]')).toHaveLength(2)
  expect(screen.queryByRole("button", { name: "Quick chats" })).toBeNull()
  await act(() => {
    return Promise.try(() => {
      client.store.setState({ threadsLoaded: true, threadsLoading: false, threads: [] })
    })
  })
  expect(screen.container.querySelectorAll('[data-slot="project-skeleton-row"]')).toHaveLength(0)
  expect(screen.getByRole("button", { name: "Quick chats" })).toHaveAttribute("aria-expanded", "false")
  await act(() => {
    return Promise.try(() => {
      client.store.setState({ threadsLoading: true })
    })
  })
  expect(screen.container.querySelectorAll('[data-slot="project-skeleton-row"]')).toHaveLength(0)
  expect(screen.getByRole("button", { name: "Quick chats" })).toBeTruthy()
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
  expect(screen.queryByRole("button", { name: "Quick chats" })).toBeNull()
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

test("empty quick chats stays first and collapsed with a project hover card", () => {
  client.store.setState({ threadsLoaded: true, threads: [] })
  const view = showSidebar()
  const quick = view.getByRole("button", { name: "Quick chats" })
  expect(quick).toHaveAttribute("aria-expanded", "false")
  expect(quick.closest('[data-slot="popover-trigger"]')).not.toBeNull()
  expect(view.getAllByRole("button").find((button) => button.hasAttribute("aria-expanded"))).toBe(quick)
})

test("double clicking Chats collapses quick chats and project groups", () => {
  const originalUi = useThreadsUiStore.getState()
  try {
    client.store.setState({ threadsLoaded: true, threads: [] })
    useThreadsUiStore.setState({
      view: "sessions",
      projectOpen: new Map([
        ["quick-chats", true],
        ["/tmp/project", true]
      ])
    })
    const view = showSidebar()
    expect(view.getByRole("button", { name: "Quick chats" })).toHaveAttribute("aria-expanded", "true")
    fireEvent.doubleClick(view.getByRole("tab", { name: "Chats" }))
    expect(view.getByRole("button", { name: "Quick chats" })).toHaveAttribute("aria-expanded", "false")
    expect(useThreadsUiStore.getState().projectOpen.size).toBe(0)
    expect(useThreadsUiStore.getState().view).toBe("sessions")
  } finally {
    useThreadsUiStore.setState(originalUi, true)
  }
})

test("each group starts with five sessions and reveals all from memory", async () => {
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
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Quick chats" }))))
    expect(view.container.querySelector('[data-slot="virtual-thread-rows"]')).toHaveAttribute("data-count", "5")
    expect(view.container.querySelectorAll("[data-session-id]").length).toBeLessThan(30)
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Show all" }))))
    expect(view.container.querySelector('[data-slot="virtual-thread-rows"]')).toHaveAttribute("data-count", "205")
    expect(view.container.querySelectorAll("[data-session-id]").length).toBeLessThan(30)
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Quick chats" }))))
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Quick chats" }))))
    expect(view.container.querySelector('[data-slot="virtual-thread-rows"]')).toHaveAttribute("data-count", "205")
    expect(view.container.querySelectorAll("[data-session-id]").length).toBeLessThan(30)
    expect(view.container.querySelector('[data-slot="virtual-thread-rows"]')).toHaveAttribute("data-count", "205")
    expect(view.container.querySelectorAll("[data-session-id]").length).toBeLessThan(30)
    expect(view.queryByRole("button", { name: "Show all" })).toBeNull()
    expect(list).not.toHaveBeenCalled()
  } finally {
    list.mockRestore()
    await act(() => Promise.try(() => useThreadsUiStore.setState(originalUi, true)))
  }
}, 20_000)

test("group expansion, load more and collapse update the scrollbar without scrolling or resizing the viewport", async () => {
  const originalUi = useThreadsUiStore.getState()
  const observers = new Map<ResizeObserverCallback, Set<Element>>()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private elements = new Set<Element>()
      private callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
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
    const viewport = must(
      view.container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]'),
      "the scroll viewport"
    )
    const content = must(viewport.firstElementChild, "the viewport content")
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
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })
    }
    // Deliver initial measurements, as the browser does when observation starts.
    await deliverResize(viewport)
    await deliverResize(content)
    expect(view.container.querySelector('[data-slot="scroll-area-scrollbar"]')).toBeNull()

    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "project" }))))
    contentHeight = 3300
    await deliverResize(content)
    const scrollbar = must(
      view.container.querySelector<HTMLElement>('[data-slot="scroll-area-scrollbar"]'),
      "the scrollbar"
    )
    Object.defineProperty(scrollbar, "offsetHeight", { value: 320 })
    await deliverResize(content)
    const expandedThumb = Number.parseFloat(scrollbar.style.getPropertyValue("--scroll-area-thumb-height"))
    expect(expandedThumb).toBeGreaterThan(20)

    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Show all" }))))
    contentHeight = 6500
    await deliverResize(content)
    expect(Number.parseFloat(scrollbar.style.getPropertyValue("--scroll-area-thumb-height"))).toBeLessThan(
      expandedThumb
    )

    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "project" }))))
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

test.each([5, 6])("%i projects use a five-project preview independent of quick chats", async (count) => {
  client.store.setState({
    threadsLoaded: true,
    threads: Array.from({ length: count }, (_, index) => ({
      sessionId: `project-${index}`,
      cwd: `/project-${index}`,
      title: "Session",
      updatedAt: null,
      archived: false
    }))
  })
  const view = showSidebar()
  expect(view.getByRole("button", { name: "Quick chats" })).toBeTruthy()
  expect(view.getAllByRole("button", { name: /^project-/ })).toHaveLength(5)
  if (count === 5) expect(view.queryByRole("button", { name: "Show all" })).toBeNull()
  else {
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Show all" }))))
    expect(view.getAllByRole("button", { name: /^project-/ })).toHaveLength(6)
    expect(view.queryByRole("button", { name: "Show all" })).toBeNull()
  }
})
