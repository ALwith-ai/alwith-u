import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest"

import { fakeProjectContext } from "@/agent/__tests__/fake-agent"
import { projectContext } from "@/agent/__tests__/project-context"
import type { SessionSummary } from "@/agent/client"
import { SidebarProvider } from "@/components/ui/sidebar"
import { SessionSidebar } from "@/features/sessions/session-sidebar"
import { useSessionsUiStore } from "@/features/sessions/store"
import { must } from "@/lib/__tests__/must"
import { useChatWindowSurface, useMainWindowSurface } from "@/lib/chat-window-state"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { ChatHeader } from "../chat-header"
import * as projectApps from "../open-in-editor"
import { ChatProjectMenu } from "../project-session-popover"

const original = client.state
const originalUi = useSessionsUiStore.getState()
const originalChatSurface = useChatWindowSurface.getState()
const originalMainSurface = useMainWindowSurface.getState()
const defaultCwd = "/Volumes/Work/Documents/ALwith"
const openDirectory = vi.fn(async (_cwd: string | null) => {})
const resolveDirectory = vi.spyOn(client, "refreshProjectContext")
afterAll(() => resolveDirectory.mockRestore())

beforeEach(async () => {
  await initI18n("en")
  resolveDirectory.mockReset().mockResolvedValue({ ...fakeProjectContext, chatDirectory: defaultCwd })
  openDirectory.mockClear()
  vi.spyOn(projectApps, "useProjectApps").mockImplementation((cwd) => ({
    apps: [],
    active: undefined,
    openWith: () => {},
    refresh: () => {},
    openPreferred: () => openDirectory(cwd)
  }))
  client.store.setState({
    connection: "ready",
    sessionList: [],
    sessionListLoaded: true,
    projectContext: projectContext(),
    sessionListError: null
  })
})
afterEach(() => {
  cleanup()
  client.store.setState(original, true)
  useSessionsUiStore.setState(originalUi, true)
  useChatWindowSurface.setState(originalChatSurface, true)
  useMainWindowSurface.setState(originalMainSurface, true)
  vi.mocked(projectApps.useProjectApps).mockRestore()
})

function sessionRow(sessionId: string, cwd: string): SessionSummary {
  return { sessionId, cwd, title: sessionId, updatedAt: "2026-10-14T00:00:00Z", archived: false }
}

test.each(["main", "floating"] as const)(
  "%s header excludes displayed conversations before counting and expanding the project list",
  async (surface) => {
    const cwd = "/tmp/project"
    const entries = Array.from({ length: 7 }, (_, index) => sessionRow(`Chat ${index}`, cwd))
    const main = sessionRow("Main chat", cwd)
    const floating = sessionRow("Floating chat", cwd)
    client.store.setState({ sessionList: [main, floating, ...entries] })
    useMainWindowSurface.setState({ sessionId: main.sessionId, visible: true })
    useChatWindowSurface.setState({ sessionId: floating.sessionId, visible: true })
    const select = vi.fn()
    const target = surface === "floating" ? document.createElement("div") : undefined
    if (target) document.body.append(target)
    const view = render(
      <ChatHeader
        target={target}
        title="Current conversation"
        project={
          <ChatProjectMenu
            cwd={cwd}
            currentSessionId={surface === "main" ? main.sessionId : floating.sessionId}
            onSelect={select}
            onNewChat={() => {}}
          />
        }
      >
        <span>Actions</span>
      </ChatHeader>
    )
    try {
      const folder = view.getByRole("button", { name: "project" })
      if (target) expect(target).toContainElement(folder)
      await act(() => Promise.resolve(fireEvent.click(folder)))
      expect(view.queryByRole("button", { name: "Main chat" })).toBeNull()
      expect(view.queryByRole("button", { name: "Floating chat" })).toBeNull()
      expect(view.getByText("7 chats")).toBeVisible()
      expect(view.getAllByRole("button", { name: /^Chat / })).toHaveLength(5)
      await act(() => Promise.resolve(fireEvent.click(view.getByRole("button", { name: "Show more" }))))
      expect(view.getAllByRole("button", { name: /^Chat / })).toHaveLength(7)
      await act(() => Promise.resolve(fireEvent.click(view.getByRole("button", { name: "Chat 6" }))))
      expect(select).toHaveBeenCalledExactlyOnceWith(entries[6])
    } finally {
      view.unmount()
      target?.remove()
    }
  }
)

test("quick chats update their empty state as windows hide and keep the current conversation excluded", async () => {
  const cwd = "/Users/mac/Documents/ALwith"
  const main = sessionRow("Main chat", cwd)
  const floating = sessionRow("Floating chat", cwd)
  client.store.setState({ sessionList: [main, floating] })
  useMainWindowSurface.setState({ sessionId: main.sessionId, visible: true })
  useChatWindowSurface.setState({ sessionId: floating.sessionId, visible: true })
  const view = render(
    <ChatProjectMenu cwd={cwd} currentSessionId={main.sessionId} onSelect={() => {}} onNewChat={() => {}} />
  )
  await act(() => Promise.resolve(fireEvent.click(view.getByRole("button", { name: "Quick chats" }))))
  expect(view.getByText("0 chats")).toBeVisible()
  expect(view.getByText("No chats found")).toBeVisible()
  expect(view.queryByRole("button", { name: "Show more" })).toBeNull()
  await act(() => {
    useChatWindowSurface.setState({ visible: false })
    useMainWindowSurface.setState({ visible: false })

    return Promise.resolve()
  })
  expect(view.getByText("1 chat")).toBeVisible()
  expect(view.queryByText("No chats found")).toBeNull()
  expect(view.getByRole("button", { name: "Floating chat" })).toBeVisible()
  expect(view.queryByRole("button", { name: "Main chat" })).toBeNull()
})

test("quick chats use the sidebar grouping and ordering before the default directory resolves", async () => {
  const pending = Promise.withResolvers<typeof fakeProjectContext>()
  resolveDirectory.mockReturnValueOnce(pending.promise)
  const select = vi.fn()
  const entries = [
    sessionRow("ALwith chat", "/Users/mac/Documents/ALwith"),
    { ...sessionRow("Codex chat", "/Users/mac/Documents/Codex/nested"), updatedAt: "2026-10-14T01:00:00Z" },
    { ...sessionRow("Home chat", "/Users/mac"), updatedAt: "2026-10-14T02:00:00Z" },
    sessionRow("Other project", "/tmp/project"),
    sessionRow("Nested project", "/Users/mac/Documents/ALwith/project"),
    sessionRow("Resolved directory chat", defaultCwd)
  ]
  client.store.setState({ sessionList: entries })
  const view = render(
    <ChatHeader title="New chat" project={<ChatProjectMenu cwd={null} onSelect={select} onNewChat={() => {}} />}>
      <span>Actions</span>
    </ChatHeader>
  )
  const folder = view.getByRole("button", { name: "Quick chats" })
  expect(folder.querySelector(".lucide-folder-closed")).not.toBeNull()
  await act(() => Promise.try(() => fireEvent.click(folder)))
  expect(view.getByRole("dialog", { name: "Quick chats" })).toBeVisible()
  expect(view.getByText("Quick chats")).toBeVisible()
  expect(view.getByText("3 chats")).toBeVisible()
  expect(view.getAllByRole("button", { name: /^(ALwith|Codex|Home) chat$/ }).map((item) => item.textContent)).toEqual([
    expect.stringContaining("Home chat"),
    expect.stringContaining("Codex chat"),
    expect.stringContaining("ALwith chat")
  ])
  expect(view.queryByRole("button", { name: "Other project" })).toBeNull()
  expect(view.queryByRole("button", { name: "Nested project" })).toBeNull()
  expect(view.queryByRole("button", { name: "Resolved directory chat" })).toBeNull()
  expect(view.getByRole("status")).toBeVisible()
  await act(() => Promise.try(() => pending.resolve({ ...fakeProjectContext, chatDirectory: defaultCwd })))
  expect(resolveDirectory).toHaveBeenCalledWith(true)
  expect(view.getByRole("button", { name: "Quick chats" })).toBe(folder)
  expect(folder).toHaveAttribute("title", "Quick chats")
  expect(view.getByText(defaultCwd)).toBeVisible()
  expect(view.getByText("3 chats")).toBeVisible()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "ALwith chat" }))))
  expect(select).toHaveBeenCalledWith(entries[0])
})

test.each([
  "/Users/mac/Documents/ALwith",
  "/Users/mac/Documents/Codex",
  "/Users/mac/Documents/Codex/nested",
  String.raw`C:\Users\Alice\Documents\ALwith`
])("quick-chat directory %s keeps the default-folder and new-chat actions", async (cwd) => {
  client.store.setState({ projectContext: projectContext(cwd.startsWith("C:") ? "C:/Users/Alice" : "/Users/mac") })
  const newChat = vi.fn()
  const view = render(<ChatProjectMenu cwd={cwd} onSelect={() => {}} onNewChat={newChat} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Quick chats" }))))
  await waitFor(() => expect(view.getByText(defaultCwd)).toBeVisible())
  expect(view.getByText("No chats found")).toBeVisible()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Open project folder" }))))
  expect(openDirectory).toHaveBeenCalledWith(defaultCwd)
  expect(newChat).not.toHaveBeenCalled()
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Quick chats" }))))
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "New chat" }))))
  expect(newChat).toHaveBeenCalledOnce()
})

test.each([
  ["/tmp/project", "project"],
  ["/Users/mac/Documents/ALwith U", "ALwith U"]
])("project %s keeps its own menu without resolving the default directory", async (cwd, name) => {
  client.store.setState({ sessionList: [sessionRow("Project chat", cwd), sessionRow("Quick chat", defaultCwd)] })
  const view = render(<ChatProjectMenu cwd={cwd} onSelect={() => {}} onNewChat={() => {}} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name }))))
  expect(view.getByRole("button", { name: "Project chat" })).toBeVisible()
  expect(view.queryByRole("button", { name: "Quick chat" })).toBeNull()
  expect(resolveDirectory).not.toHaveBeenCalled()
})

test("a delayed default-directory result cannot replace a newly selected project", async () => {
  const pending = Promise.withResolvers<typeof fakeProjectContext>()
  resolveDirectory.mockReturnValueOnce(pending.promise)
  const view = render(<ChatProjectMenu cwd={null} onSelect={() => {}} onNewChat={() => {}} />)
  view.rerender(<ChatProjectMenu cwd="/tmp/project" onSelect={() => {}} onNewChat={() => {}} />)
  await act(() => Promise.try(() => pending.resolve({ ...fakeProjectContext, chatDirectory: defaultCwd })))
  expect(view.getByRole("button", { name: "project" })).toHaveAttribute("title", "/tmp/project")
  expect(view.queryByRole("button", { name: "Quick chats" })).toBeNull()
})

test("directory errors leave quick chats available and support retry without inventing a path", async () => {
  resolveDirectory.mockRejectedValueOnce(new Error("Documents directory unavailable"))
  client.store.setState({ sessionList: [sessionRow("Existing quick chat", "/Users/mac/Documents/Codex")] })
  const view = render(<ChatProjectMenu cwd={null} onSelect={() => {}} onNewChat={() => {}} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Quick chats" }))))
  expect(view.getByRole("alert")).toHaveTextContent("Documents directory unavailable")
  expect(view.getByRole("button", { name: "Existing quick chat" })).toBeVisible()
  expect(view.queryByRole("button", { name: "Open project folder" })).toBeNull()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Retry" }))))
  await waitFor(() => expect(view.getByText(defaultCwd)).toBeVisible())
  expect(resolveDirectory).toHaveBeenCalledTimes(2)
})

test("clearing a project switches the open menu to localized quick chats and follows the shared list", async () => {
  await initI18n("zh-CN")
  client.store.setState({ sessionList: [sessionRow("Project chat", "/tmp/project")] })
  const view = render(<ChatProjectMenu cwd="/tmp/project" onSelect={() => {}} onNewChat={() => {}} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "project" }))))
  await act(() =>
    Promise.try(() => view.rerender(<ChatProjectMenu cwd={null} onSelect={() => {}} onNewChat={() => {}} />))
  )
  expect(view.getByRole("dialog", { name: "随聊" })).toBeVisible()
  expect(view.getByText("随聊")).toBeVisible()
  expect(view.queryByRole("button", { name: "Project chat" })).toBeNull()
  await act(() =>
    Promise.try(() =>
      client.store.setState({ sessionList: [sessionRow("New quick chat", "/Users/mac/Documents/ALwith")] })
    )
  )
  expect(view.getByRole("button", { name: "New quick chat" })).toBeVisible()
})

test("the sidebar quick-chat hover shares the header list and default folder while clicks still expand the group", async () => {
  const entries = [
    sessionRow("ALwith chat", "/Users/mac/Documents/ALwith"),
    sessionRow("Codex chat", "/Users/mac/Documents/Codex")
  ]
  client.store.setState({ sessionList: [...entries, sessionRow("Other project", "/tmp/project")] })
  useSessionsUiStore.setState({ projectOpen: new Map(), view: "sessions" })
  const select = vi.fn()
  const newChat = vi.fn()
  const newProjectChat = vi.fn()
  const header = render(<ChatProjectMenu cwd={null} onSelect={select} onNewChat={newChat} />)
  await act(() => Promise.try(() => fireEvent.click(header.getByRole("button", { name: "Quick chats" }))))
  const headerChats = header
    .getAllByRole("button", { name: /^(ALwith|Codex) chat$/ })
    .map((button) => button.textContent)
  expect(header.getByText(defaultCwd)).toBeVisible()
  header.unmount()

  const sidebar = render(
    <SidebarProvider>
      <SessionSidebar
        screen="main"
        leadingPage="plugins"
        selectedId={null}
        onSelect={select}
        onNewChat={newChat}
        onNewProjectChat={newProjectChat}
        onSearch={() => {}}
        onOpenWindow={() => {}}
        onOpenSettings={() => {}}
        onOpenPlugins={() => {}}
        onSwitchScreen={() => {}}
      />
    </SidebarProvider>
  )
  const group = sidebar.getByRole("button", { name: "Quick chats" })
  await act(() => Promise.try(() => fireEvent.click(group)))
  expect(group).toHaveAttribute("aria-expanded", "true")
  expect(sidebar.queryByRole("dialog")).toBeNull()
  const trigger = must(group.closest<HTMLElement>('[data-slot="popover-trigger"]'), "the quick-chat hover trigger")
  const open = async () => {
    await act(() => {
      return Promise.try(() => {
        fireEvent.pointerEnter(trigger, { pointerType: "mouse" })
        fireEvent.mouseEnter(trigger)
        fireEvent.mouseMove(trigger)
      })
    })
    return within(await sidebar.findByRole("dialog", { name: "Quick chats" }))
  }
  const popup = await open()
  expect(popup.getAllByRole("button", { name: /^(ALwith|Codex) chat$/ }).map((button) => button.textContent)).toEqual(
    headerChats
  )
  expect(popup.queryByRole("button", { name: "Other project" })).toBeNull()
  expect(popup.getByText(defaultCwd)).toBeVisible()
  await act(() => Promise.try(() => fireEvent.click(popup.getByRole("button", { name: "Open project folder" }))))
  expect(openDirectory).toHaveBeenCalledWith(defaultCwd)
  await waitFor(() => expect(sidebar.queryByRole("dialog")).toBeNull())
  fireEvent.mouseLeave(trigger)
  const reopened = await open()
  await act(() => Promise.try(() => fireEvent.click(reopened.getByRole("button", { name: "New chat" }))))
  expect(newProjectChat).toHaveBeenCalledExactlyOnceWith(null)
  expect(newChat).not.toHaveBeenCalled()
})
