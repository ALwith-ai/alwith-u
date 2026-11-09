import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { afterEach, expect, test, vi } from "vitest"

// The shell owns the updater; this screen only places its card in the navigation footer.
vi.mock("@alwith/module-desktop-shell/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DesktopUpdateStatus: () => <button type="button">Relaunch to update</button>
}))

import { projectContext } from "@/agent/__tests__/project-context"
import { usePlatformAuth } from "@/features/auth/store"
import { type MainScreen, MainSidebarLayout } from "@/features/layout/components/main-sidebar-layout"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { SessionSidebar } from "../session-sidebar"
import { useSessionsUiStore } from "../store"

await initI18n("en")
const originalState = client.state
const originalAuth = usePlatformAuth.getState()
const originalUi = useSessionsUiStore.getState()

function sidebar() {
  return render(
    <SessionSidebar
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
      onSwitchScreen={() => {}}
      drivePanel={<div>Drive panel</div>}
    />,
    {
      wrapper: ({ children }) => (
        <MainSidebarLayout initialPinned screen="main" leading={null} main={null} sidebar={children} />
      )
    }
  )
}

test("tab actions open activity search, create collections, and control Drive search", async () => {
  usePlatformAuth.setState({
    isAuthenticated: true,
    user: { ...originalAuth.user, login_email: "test@finture.id" } as NonNullable<typeof originalAuth.user>
  })
  const view = sidebar()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("tab", { name: "Activity" }))))
  const search = view.getByRole("button", { name: "Search activity titles" })
  fireEvent.click(search)
  const input = view.getByRole("textbox", { name: "Search activity titles" })
  expect(search).toHaveAttribute("aria-expanded", "true")
  fireEvent.change(input, { target: { value: "report" } })
  fireEvent.keyDown(input, { key: "Escape" })
  expect(view.queryByRole("textbox", { name: "Search activity titles" })).toBeNull()
  fireEvent.click(search)
  expect(view.getByRole("textbox", { name: "Search activity titles" })).toHaveValue("")
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("tab", { name: "Collections" }))))
  fireEvent.click(view.getByRole("button", { name: "Create Collection" }))
  fireEvent.click(view.getByRole("menuitem", { name: "Create Collection" }))
  expect(view.getByRole("dialog")).toBeVisible()
  expect(view.getByRole("textbox", { name: "Collection name" })).toHaveFocus()
  fireEvent.click(view.getByRole("button", { name: "Cancel" }))
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("tab", { name: "Drive" }))))
  const driveSearch = view.getByRole("button", { name: "Search drive" })
  fireEvent.click(driveSearch)
  expect(useSessionsUiStore.getState().driveSearchOpen).toBe(true)
  fireEvent.click(driveSearch)
  expect(useSessionsUiStore.getState().driveSearchOpen).toBe(false)
})

afterEach(async () => {
  await act(async () => {
    cleanup()
    client.store.setState(originalState, true)
    usePlatformAuth.setState(originalAuth, true)
    useSessionsUiStore.setState(originalUi, true)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

test("footer arrows switch screens, plugins are selected only on the leading screen, and new chat returns to main", async () => {
  // The plugins entry is fixed navigation: it does not wait for the engine to connect.
  client.store.setState({ connection: "connecting", agent: null })
  function Harness() {
    const [screen, setScreen] = useState<MainScreen>("main")
    return (
      <MainSidebarLayout
        initialPinned
        screen={screen}
        leading={<main>Plugin content</main>}
        main={<main>Chat content</main>}
        sidebar={
          <SessionSidebar
            screen={screen}
            leadingPage="plugins"
            selectedId={null}
            onSelect={() => setScreen("main")}
            onNewChat={() => setScreen("main")}
            onNewProjectChat={() => {}}
            onSearch={() => {}}
            onOpenWindow={() => {}}
            onOpenSettings={() => {}}
            onOpenPlugins={() => setScreen("leading")}
            onSwitchScreen={() => setScreen(screen === "main" ? "leading" : "main")}
          />
        }
      />
    )
  }
  const view = render(<Harness />)
  const plugins = view.getByRole("button", { name: "Customize" })
  const arrow = view.getByRole("button", { name: "Open -1 screen" })
  const updateCard = view.getByRole("button", { name: /Relaunch to update/ })
  expect(updateCard.closest('[data-slot="sidebar-footer"]')).toBe(arrow.closest('[data-slot="sidebar-footer"]'))
  expect(arrow.closest('[data-slot="sidebar-footer"]')).not.toBeNull()
  expect(arrow.querySelector(".lucide-arrow-left")).toBeTruthy()
  expect(arrow.classList.contains("justify-start")).toBe(true)
  expect(arrow.classList.contains("justify-end")).toBe(false)
  expect(plugins.hasAttribute("aria-current")).toBe(false)
  await act(() => Promise.try(() => fireEvent.click(arrow)))
  expect(plugins.getAttribute("aria-current")).toBe("page")
  expect(view.getByRole("button", { name: "Back to main screen" }).querySelector(".lucide-arrow-right")).toBeTruthy()
  expect(arrow.classList.contains("justify-end")).toBe(true)
  expect(arrow.classList.contains("justify-start")).toBe(false)
  expect(view.container.querySelector('[data-screen-panel="chat"]')?.getAttribute("aria-hidden")).toBe("true")
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Back to main screen" }))))
  expect(view.getByRole("button", { name: "Open -1 screen" })).toBe(arrow)
  expect(arrow.classList.contains("justify-start")).toBe(true)
  expect(plugins.hasAttribute("aria-current")).toBe(false)
  await act(() => Promise.try(() => fireEvent.click(plugins)))
  expect(plugins.getAttribute("aria-current")).toBe("page")
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "New chat" }))))
  expect(view.getByRole("button", { name: "Open -1 screen" })).toBeTruthy()
  expect(plugins.hasAttribute("aria-current")).toBe(false)
})

test("customization replaces the standalone extension entry and remains available without Codex", async () => {
  client.store.setState({
    agent: {
      info: { name: "test", version: "1" },
      protocolVersion: 2,
      capabilities: { _meta: { codex: { plugins: true } } }
    }
  })
  function Harness() {
    const [screen, setScreen] = useState<MainScreen>("main")
    const [leadingPage, setLeadingPage] = useState<"plugins" | "extensions">("plugins")
    return (
      <MainSidebarLayout
        initialPinned
        screen={screen}
        leading={<main>{leadingPage === "extensions" ? "Extension management" : "Plugin content"}</main>}
        main={<main>Chat content</main>}
        sidebar={
          <SessionSidebar
            screen={screen}
            leadingPage={leadingPage}
            selectedId={null}
            onSelect={() => setScreen("main")}
            onNewChat={() => setScreen("main")}
            onNewProjectChat={() => {}}
            onSearch={() => {}}
            onOpenWindow={() => {}}
            onOpenSettings={() => {}}
            onOpenPlugins={() => {
              setLeadingPage("plugins")
              setScreen("leading")
            }}
            onSwitchScreen={() => setScreen(screen === "main" ? "leading" : "main")}
          />
        }
      />
    )
  }
  const view = render(<Harness />)
  const customize = view.getByRole("button", { name: "Customize" })
  expect(view.queryByRole("button", { name: "Extensions" })).toBeNull()
  await act(() => Promise.try(() => fireEvent.click(customize)))
  expect(customize).toHaveAttribute("aria-current", "page")
  expect(view.getByText("Plugin content")).toBeTruthy()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Back to main screen" }))))
  expect(customize.hasAttribute("aria-current")).toBe(false)
  await act(() => Promise.try(() => client.store.setState({ agent: null })))
  expect(view.getByRole("button", { name: "Customize" })).toBe(customize)
  expect(view.queryByRole("button", { name: "Extensions" })).toBeNull()
})

test("Drive mounts on first visit and retains input across tab switches until access is lost", async () => {
  usePlatformAuth.setState({
    isAuthenticated: true,
    user: { ...originalAuth.user, login_email: "test@finture.id" } as NonNullable<typeof originalAuth.user>
  })
  useSessionsUiStore.setState({ view: "sessions" })
  const view = render(
    <MainSidebarLayout
      initialPinned
      screen="main"
      leading={null}
      main={null}
      sidebar={
        <SessionSidebar
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
          onSwitchScreen={() => {}}
          drivePanel={<input aria-label="Drive filter" defaultValue="" />}
        />
      }
    />
  )
  expect(view.queryByLabelText("Drive filter")).toBeNull()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("tab", { name: "Drive" }))))
  const input = view.getByLabelText("Drive filter")
  fireEvent.change(input, { target: { value: "report" } })
  for (const name of ["Activity", "Chats"]) {
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("tab", { name }))))
    expect(input).toBeInTheDocument()
    expect(input).not.toBeVisible()
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("tab", { name: "Drive" }))))
    expect(view.getByLabelText("Drive filter")).toBe(input)
    expect(input).toHaveValue("report")
    expect(input).toBeVisible()
  }
  await act(() => Promise.try(() => usePlatformAuth.setState({ isAuthenticated: false })))
  expect(view.queryByLabelText("Drive filter")).toBeNull()
  expect(useSessionsUiStore.getState().view).toBe("sessions")
})

test("project counts show only the number of sessions", () => {
  useSessionsUiStore.setState({ view: "sessions" })
  client.store.setState({
    sessionListLoaded: true,
    projectContext: projectContext(),
    sessionList: [
      { sessionId: "one", cwd: "/tmp/project", title: "One", updatedAt: null, archived: false },
      { sessionId: "two", cwd: "/tmp/project", title: "Two", updatedAt: null, archived: false }
    ]
  })
  const view = render(
    <MainSidebarLayout
      initialPinned
      screen="main"
      leading={null}
      main={null}
      sidebar={
        <SessionSidebar
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
          onSwitchScreen={() => {}}
        />
      }
    />
  )
  expect(view.getByText("2", { exact: true })).toBeVisible()
  expect(view.queryByText(/loaded/i)).toBeNull()
  expect(view.queryByRole("button", { name: "Load more" })).toBeNull()
})

test("Vibemon sits below customization and selects its own leading page without an agent connection", async () => {
  client.store.setState({ connection: "disconnected", agent: null })
  function Harness() {
    const [screen, setScreen] = useState<MainScreen>("main")
    const [page, setPage] = useState<"plugins" | "extensions" | "vibemon">("plugins")
    const open = (next: typeof page) => {
      setPage(next)
      setScreen("leading")
    }
    return (
      <MainSidebarLayout
        initialPinned
        screen={screen}
        leading={<main>{page}</main>}
        main={<main>Chat content</main>}
        sidebar={
          <SessionSidebar
            screen={screen}
            leadingPage={page}
            selectedId={null}
            onSelect={() => setScreen("main")}
            onNewChat={() => setScreen("main")}
            onNewProjectChat={() => {}}
            onSearch={() => {}}
            onOpenWindow={() => {}}
            onOpenSettings={() => {}}
            onOpenPlugins={() => open("plugins")}
            onOpenVibemon={() => open("vibemon")}
            onSwitchScreen={() => setScreen(screen === "main" ? "leading" : "main")}
          />
        }
      />
    )
  }
  const view = render(<Harness />)
  const vibemon = view.getByRole("button", { name: "Vibémon" })
  const customize = view.getByRole("button", { name: "Customize" })
  expect(customize.nextElementSibling).toBe(vibemon)
  expect(vibemon.closest('[data-slot="sidebar-header"]')).not.toBeNull()
  await act(() => Promise.try(() => fireEvent.click(vibemon)))
  expect(vibemon.getAttribute("aria-current")).toBe("page")
  expect(customize.hasAttribute("aria-current")).toBe(false)
  expect(view.container.querySelector('[data-screen-panel="chat"]')?.getAttribute("aria-hidden")).toBe("true")
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Back to main screen" }))))
  expect(vibemon.hasAttribute("aria-current")).toBe(false)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Open -1 screen" }))))
  expect(vibemon.getAttribute("aria-current")).toBe("page")
})
