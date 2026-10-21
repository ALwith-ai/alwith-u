import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest"

import type { ThreadSummary } from "@/agent/client"
import { commands } from "@/bindings"
import { SidebarProvider } from "@/components/ui/sidebar"
import { useThreadsUiStore } from "@/features/threads/store"
import { ThreadSidebar } from "@/features/threads/thread-sidebar"
import { must } from "@/lib/__tests__/must"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { ChatHeader } from "../chat-header"
import * as projectApps from "../open-in-editor"
import { ChatProjectMenu } from "../project-session-popover"

const original = client.state
const originalUi = useThreadsUiStore.getState()
const defaultCwd = "/Volumes/Work/Documents/ALwith U"
const openDirectory = vi.fn(async (_cwd: string | null) => {})
const resolveDirectory = vi.spyOn(commands, "draftDirectory")
afterAll(() => resolveDirectory.mockRestore())

beforeEach(async () => {
  await initI18n("en")
  resolveDirectory.mockReset().mockResolvedValue(defaultCwd)
  openDirectory.mockClear()
  vi.spyOn(projectApps, "useProjectApps").mockImplementation((cwd) => ({
    apps: [],
    active: undefined,
    openWith: () => {},
    refresh: () => {},
    openPreferred: () => openDirectory(cwd)
  }))
  client.store.setState({ connection: "ready", threads: [], threadsLoaded: true, threadsError: null })
})
afterEach(() => {
  cleanup()
  client.store.setState(original, true)
  useThreadsUiStore.setState(originalUi, true)
  vi.mocked(projectApps.useProjectApps).mockRestore()
})

function thread(sessionId: string, cwd: string): ThreadSummary {
  return { sessionId, cwd, title: sessionId, updatedAt: "2026-10-14T00:00:00Z", archived: false }
}

test("quick chats use the sidebar grouping and ordering before the default directory resolves", async () => {
  const pending = Promise.withResolvers<string>()
  resolveDirectory.mockReturnValueOnce(pending.promise)
  const select = vi.fn()
  const entries = [
    thread("ALwith chat", "/Users/mac/Documents/ALwith U"),
    { ...thread("Codex chat", "/Users/mac/Documents/Codex/nested"), updatedAt: "2026-10-14T01:00:00Z" },
    { ...thread("Windows chat", String.raw`C:\Users\Alice\Documents\Codex`), updatedAt: "2026-10-14T02:00:00Z" },
    thread("Other project", "/tmp/project"),
    thread("Nested project", "/Users/mac/Documents/ALwith U/project"),
    thread("Resolved directory chat", defaultCwd)
  ]
  client.store.setState({ threads: entries })
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
  expect(
    view.getAllByRole("button", { name: /^(ALwith|Codex|Windows) chat$/ }).map((item) => item.textContent)
  ).toEqual([
    expect.stringContaining("Windows chat"),
    expect.stringContaining("Codex chat"),
    expect.stringContaining("ALwith chat")
  ])
  expect(view.queryByRole("button", { name: "Other project" })).toBeNull()
  expect(view.queryByRole("button", { name: "Nested project" })).toBeNull()
  expect(view.queryByRole("button", { name: "Resolved directory chat" })).toBeNull()
  expect(view.getByRole("status")).toBeVisible()
  await act(() => Promise.try(() => pending.resolve(defaultCwd)))
  expect(resolveDirectory).toHaveBeenCalledWith({ cwd: null })
  expect(view.getByRole("button", { name: "Quick chats" })).toBe(folder)
  expect(folder).toHaveAttribute("title", "Quick chats")
  expect(view.getByText(defaultCwd)).toBeVisible()
  expect(view.getByText("3 chats")).toBeVisible()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "ALwith chat" }))))
  expect(select).toHaveBeenCalledWith(entries[0])
})

test.each([
  "/Users/mac/Documents/ALwith U",
  "/Users/mac/Documents/Codex",
  "/Users/mac/Documents/Codex/nested",
  String.raw`C:\Users\Alice\Documents\ALwith U`
])("quick-chat directory %s keeps the default-folder and new-chat actions", async (cwd) => {
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

test("an explicit project keeps its own menu without resolving the default directory", async () => {
  client.store.setState({ threads: [thread("Project chat", "/tmp/project"), thread("Quick chat", defaultCwd)] })
  const view = render(<ChatProjectMenu cwd="/tmp/project" onSelect={() => {}} onNewChat={() => {}} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "project" }))))
  expect(view.getByRole("button", { name: "Project chat" })).toBeVisible()
  expect(view.queryByRole("button", { name: "Quick chat" })).toBeNull()
  expect(resolveDirectory).not.toHaveBeenCalled()
})

test("a delayed default-directory result cannot replace a newly selected project", async () => {
  const pending = Promise.withResolvers<string>()
  resolveDirectory.mockReturnValueOnce(pending.promise)
  const view = render(<ChatProjectMenu cwd={null} onSelect={() => {}} onNewChat={() => {}} />)
  view.rerender(<ChatProjectMenu cwd="/tmp/project" onSelect={() => {}} onNewChat={() => {}} />)
  await act(() => Promise.try(() => pending.resolve(defaultCwd)))
  expect(view.getByRole("button", { name: "project" })).toHaveAttribute("title", "/tmp/project")
  expect(view.queryByRole("button", { name: "Quick chats" })).toBeNull()
})

test("directory errors leave quick chats available and support retry without inventing a path", async () => {
  resolveDirectory.mockRejectedValueOnce(new Error("Documents directory unavailable"))
  client.store.setState({ threads: [thread("Existing quick chat", "/Users/mac/Documents/Codex")] })
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
  client.store.setState({ threads: [thread("Project chat", "/tmp/project")] })
  const view = render(<ChatProjectMenu cwd="/tmp/project" onSelect={() => {}} onNewChat={() => {}} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "project" }))))
  await act(() =>
    Promise.try(() => view.rerender(<ChatProjectMenu cwd={null} onSelect={() => {}} onNewChat={() => {}} />))
  )
  expect(view.getByRole("dialog", { name: "随聊" })).toBeVisible()
  expect(view.getByText("随聊")).toBeVisible()
  expect(view.queryByRole("button", { name: "Project chat" })).toBeNull()
  await act(() =>
    Promise.try(() => client.store.setState({ threads: [thread("New quick chat", "/Users/mac/Documents/ALwith U")] }))
  )
  expect(view.getByRole("button", { name: "New quick chat" })).toBeVisible()
})

test("the sidebar quick-chat hover shares the header list and default folder while clicks still expand the group", async () => {
  const entries = [
    thread("ALwith chat", "/Users/mac/Documents/ALwith U"),
    thread("Codex chat", "/Users/mac/Documents/Codex")
  ]
  client.store.setState({ threads: [...entries, thread("Other project", "/tmp/project")] })
  useThreadsUiStore.setState({ projectOpen: new Map(), view: "sessions" })
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
      <ThreadSidebar
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
        onOpenExtensions={() => {}}
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
