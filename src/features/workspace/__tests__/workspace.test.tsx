import {
  type DesktopCanvas,
  DesktopCanvasContext as CanvasContext,
  DesktopWorkspaceControlsContext as WindowsWorkspaceControlsContext
} from "@alwith/module-desktop-shell/react"
import type { TextEditorProps } from "@alwith/module-editor"
import { type FsAdapter, normalizePath, type WriteOptions } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import * as opener from "@tauri-apps/plugin-opener"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { type ReactNode, StrictMode, useLayoutEffect, useState } from "react"
import { toast } from "sonner"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { projectContext } from "@/agent/__tests__/project-context"
import { ChatHeader } from "@/features/chat/chat-header"
import { openGuideWindow } from "@/features/guide/guide-window"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { useWorkspace, WorkspaceHeaderContext } from "../context"
import { FileWorkspace } from "../file-workspace"
import { PreviewPaneContext } from "../preview-pane-context"

vi.mock("@/features/guide/guide-window", () => ({ openGuideWindow: vi.fn() }))
vi.mock("@tauri-apps/plugin-opener", async (original) => ({ ...(await original<object>()) }))

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn((_event: string, _handler: () => void) => Promise.resolve((): void => {})),
  nativeMode: false,
  close: null as ((event: { preventDefault(): void }) => void) | null
}))
let clipboardText: string
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (text: string): Promise<void> => {
    clipboardText = text
    return Promise.resolve()
  }
}))
vi.mock("@/components/theme-provider", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => native.nativeMode }))
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: native.listen,
    onDragDropEvent: () => Promise.resolve((): void => {}),
    onCloseRequested: (callback: (event: { preventDefault(): void }) => void) => {
      native.close = callback
      return Promise.resolve((): void => {
        native.close = null
      })
    }
  })
}))
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen, emit: vi.fn(), emitTo: vi.fn() }))
vi.mock("@/features/chat/codex/markdown-renderer", () => ({
  CodexMarkdownRenderer: ({ text }: { text: string }) => <article>{text}</article>
}))
vi.mock("../monaco-editor", () => ({
  default: (props: TextEditorProps) => (
    <textarea aria-label="Code" value={props.document.text} onChange={(event) => props.onChange(event.target.value)} />
  ),
  releaseMonaco: vi.fn()
}))
function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Missing native request field")
  return value
}
/** Commands of the shared filesystem plugin, with their flat named arguments. */
const FS = "plugin:alwith-fs|"
type NativeArgs = {
  cwd?: string
  root?: string
  path?: string
  to?: string
  enabled?: boolean
  showHidden?: boolean
  showIgnored?: boolean
  data?: number[]
  mode?: WriteOptions["mode"]
  expectedVersion?: string | null
}
let adapter: FsAdapter
let authorize: ((path: string) => Promise<string>) | null
beforeEach(async () => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(280)
  // @tanstack/react-virtual 3.14.21 measures the scroll element with clientHeight / clientWidth.
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("file-workspace-layout") ? 1000 : 280
  })
  native.nativeMode = false
  native.close = null
  await initI18n("en")
  vi.spyOn(client, "refreshProjectContext").mockResolvedValue({ ...projectContext(), chatDirectory: "/a" })
  authorize = null
  adapter = createMemoryAdapter({ "/a/one.txt": "first", "/b/two.txt": "second" })
  native.invoke.mockImplementation(async (command: string, args: NativeArgs): Promise<unknown> => {
    if (command === "draft_directory") return args.cwd
    if (command === "workspace_dirty" || command === "workspace_exit") return null
    const operation = command.startsWith(FS) ? command.slice(FS.length) : null
    switch (operation) {
      case "workspace_open":
        return authorize === null ? args.path : authorize(required(args.path))
      case "workspace_watch":
        return null
      case "workspace_stat":
        return adapter.stat(required(args.path))
      case "workspace_read_directory":
        return adapter.readDirectory(required(args.path), {
          showHidden: required(args.showHidden),
          showIgnored: required(args.showIgnored)
        })
      case "workspace_read_file":
        return [...(await adapter.readFile(required(args.path)))]
      case "workspace_write_file":
        return adapter.writeFile(required(args.path), new Uint8Array(required(args.data)), {
          mode: required(args.mode),
          expectedVersion: args.expectedVersion ?? undefined
        })
      case "workspace_move":
        return adapter.move(required(args.path), required(args.to))
      case "workspace_copy":
        return adapter.copy(required(args.path), required(args.to))
      case "workspace_create_directory":
        return adapter.createDirectory(required(args.path))
      case "workspace_remove":
        return adapter.remove(required(args.path))
      default:
        throw new Error(`Unexpected native command: ${command}`)
    }
  })
})

test("opening a projectless workspace uses the adapter's default chat directory", async () => {
  const reportError = vi.spyOn(toast, "error")
  render(<Surface cwd={null} />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  expect(await screen.findByRole("treeitem", { name: "one.txt" })).toBeVisible()
  expect(native.invoke).not.toHaveBeenCalledWith("draft_directory", { cwd: null })
  expect(reportError).not.toHaveBeenCalled()
})

test("a project switch through a projectless state opens the target without errors", async () => {
  const reportError = vi.spyOn(toast, "error")
  const view = render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  await screen.findByRole("treeitem", { name: "one.txt" })
  view.rerender(<Surface cwd={null} />)
  await screen.findByRole("treeitem", { name: "one.txt" })
  view.rerender(<Surface cwd="/b" />)
  expect(await screen.findByRole("treeitem", { name: "two.txt" })).toBeVisible()
  expect(screen.queryByRole("treeitem", { name: "one.txt" })).toBeNull()
  expect(reportError).not.toHaveBeenCalled()
})

test("a superseded directory failure cannot interrupt the current project", async () => {
  const reportError = vi.spyOn(toast, "error")
  const pending = Promise.withResolvers<string>()
  const view = render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  await screen.findByRole("treeitem", { name: "one.txt" })
  authorize = (path) => (path === "/missing" ? pending.promise : Promise.resolve(path))
  view.rerender(<Surface cwd="/missing" />)
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith(`${FS}workspace_open`, { path: "/missing" }))
  view.rerender(<Surface cwd="/b" />)
  await screen.findByRole("treeitem", { name: "two.txt" })
  await act(async () => {
    pending.reject(new Error("Project directory is unavailable"))
    await expect(pending.promise).rejects.toThrow("Project directory is unavailable")
  })
  expect(screen.getByRole("treeitem", { name: "two.txt" })).toBeVisible()
  expect(reportError).not.toHaveBeenCalled()
})

test("a delayed default directory cannot replace a newly selected project", async () => {
  const reportError = vi.spyOn(toast, "error")
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof client.refreshProjectContext>>>()
  const view = render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  await screen.findByRole("treeitem", { name: "one.txt" })
  vi.spyOn(client, "refreshProjectContext").mockReturnValueOnce(pending.promise)
  view.rerender(<Surface cwd={null} />)
  view.rerender(<Surface cwd="/b" />)
  await screen.findByRole("treeitem", { name: "two.txt" })
  await act(async () => {
    pending.resolve({ ...projectContext(), chatDirectory: "/a" })
    await pending.promise
  })
  expect(screen.getByRole("treeitem", { name: "two.txt" })).toBeVisible()
  expect(screen.queryByRole("treeitem", { name: "one.txt" })).toBeNull()
  expect(reportError).not.toHaveBeenCalled()
})

test("remount restores pinned files, active file and expanded folders without draft persistence", async () => {
  const view = render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  const row = await screen.findByRole("treeitem", { name: /one.txt/ })
  fireEvent.doubleClick(row)
  await screen.findByRole("textbox", { name: "Code" })
  fireEvent.change(screen.getByRole("textbox", { name: "Code" }), { target: { value: "unsaved body" } })
  await waitFor(() => expect(localStorage.getItem("workspace:/a")).toContain('"pinned":true'))
  expect(localStorage.getItem("workspace:/a")).not.toContain("unsaved body")
  view.unmount()
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  expect(await screen.findByRole("textbox", { name: "Code" })).toHaveValue("first")
  expect(screen.getByRole("tab", { name: "one.txt" }).closest("[data-transient]")).toHaveAttribute(
    "data-transient",
    "false"
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
test("Windows moves only the workspace toggle into the title bar and preserves its action", async () => {
  const target = document.createElement("div")
  document.body.append(target)
  try {
    const view = render(
      <WindowsWorkspaceControlsContext.Provider value={target}>
        <Surface cwd="/a" />
      </WindowsWorkspaceControlsContext.Provider>
    )
    fireEvent.click(within(target).getByRole("button", { name: "Open workspace" }))
    await screen.findByRole("treeitem", { name: /one.txt/ })
    expect(within(target).getByRole("button", { name: "Close workspace" })).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(screen.getByRole("button", { name: "Maximize" }))
    expect(document.querySelector(".file-workspace-layout")).toHaveAttribute("data-view-mode", "true")
    fireEvent.click(screen.getByRole("button", { name: "Restore" }))
    expect(document.querySelector(".file-workspace-layout")).toHaveAttribute("data-view-mode", "false")
    fireEvent.click(within(target).getByRole("button", { name: "Close workspace" }))
    expect(within(target).getByRole("button", { name: "Open workspace" })).toHaveAttribute("aria-expanded", "false")
    view.unmount()
    expect(target).toBeEmptyDOMElement()
  } finally {
    target.remove()
  }
})
function Surface({
  cwd,
  chatRevealRequest = 0,
  children
}: {
  cwd: string | null
  chatRevealRequest?: number
  children?: ReactNode
}) {
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null)
  return (
    <WorkspaceHeaderContext.Provider value={toolbar}>
      <div ref={setToolbar} data-testid="window-titlebar" />
      <FileWorkspace cwd={cwd} chatRevealRequest={chatRevealRequest}>
        <ChatHeader title="Conversation" project={<span>Project</span>}>
          {null}
        </ChatHeader>
        <div>Chat {cwd}</div>
        {children}
      </FileWorkspace>
    </WorkspaceHeaderContext.Provider>
  )
}

function NavigationProbe() {
  const workspace = required(useWorkspace())
  return (
    <>
      <output data-testid="workspace-pane">{workspace.pane}</output>
      <button onClick={() => workspace.openPane?.("simulator")}>Show simulator</button>
      <button onClick={() => void workspace.openFile("/a/one.txt", "/a")}>Open linked file</button>
      <button onClick={() => void workspace.openProject("/a")}>Open project</button>
      <button onClick={() => void workspace.revealEntry("/a/one.txt", "/a")}>Reveal entry</button>
      <button onClick={() => void workspace.openFile("/b/two.txt", "/b")}>Open other file</button>
    </>
  )
}

test.each(["Open linked file", "Open project", "Reveal entry", "new tab", "project tree"])(
  "%s switches from the simulator to files",
  async (action) => {
    render(
      <Surface cwd="/a">
        <NavigationProbe />
      </Surface>
    )
    fireEvent.click(screen.getByRole("button", { name: "Show simulator" }))
    expect(screen.getByTestId("workspace-pane")).toHaveTextContent("simulator")
    if (action === "new tab") fireEvent.keyDown(window, { key: "t", metaKey: true })
    else if (action === "project tree") fireEvent.keyDown(window, { key: "e", metaKey: true, shiftKey: true })
    else fireEvent.click(screen.getByRole("button", { name: action }))
    await waitFor(() => expect(screen.getByTestId("workspace-pane")).toHaveTextContent("files"))
    expect(await screen.findByRole("treeitem", { name: "one.txt" })).toBeVisible()
  }
)

test.each(["project switch", "newer navigation"])("a delayed reveal cannot override %s", async (action) => {
  const pending = Promise.withResolvers<string>()
  authorize = (path) => (path === "/a" ? pending.promise : Promise.resolve(path))
  const surface = (cwd: string) => (
    <Surface cwd={cwd}>
      <NavigationProbe />
    </Surface>
  )
  const view = render(surface("/a"))
  fireEvent.click(screen.getByRole("button", { name: "Reveal entry" }))
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith(`${FS}workspace_open`, { path: "/a" }))
  if (action === "project switch") view.rerender(surface("/b"))
  fireEvent.click(screen.getByRole("button", { name: "Open other file" }))
  expect(await screen.findByRole("tab", { name: "two.txt" })).toBeVisible()
  await act(async () => {
    pending.resolve("/a")
    await pending.promise
  })
  expect(screen.getByRole("treeitem", { name: "two.txt" })).toBeVisible()
  expect(screen.queryByRole("treeitem", { name: "one.txt" })).toBeNull()
})

test.each(["en", "zh-CN"])("workspace entry describes its action in %s", async (locale) => {
  await initI18n(locale)
  render(<Surface cwd="/a" />)
  const label = locale === "en" ? "Open workspace" : "打开工作区"
  expect(screen.getByRole("button", { name: label })).toHaveAttribute("title", label)
})

test.each(["tree", "tab"])("copies the %s file path without browser clipboard access", async (surface) => {
  clipboardText = ""
  const browserWrite = vi.fn((): Promise<void> => {
    return Promise.try(() => {
      throw new DOMException("Clipboard access denied", "NotAllowedError")
    })
  })
  const previousClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: browserWrite } })
  try {
    render(<Surface cwd="/a" />)
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
    const file = await screen.findByRole("treeitem", { name: "one.txt" })
    if (surface === "tab") {
      fireEvent.doubleClick(file)
      await screen.findByRole("textbox", { name: "Code" })
    }
    fireEvent.contextMenu(surface === "tree" ? file : screen.getByRole("tab", { name: "one.txt" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy path" }))
    await waitFor(() => expect(clipboardText).toBe("/a/one.txt"))
    expect(browserWrite).not.toHaveBeenCalled()
  } finally {
    if (previousClipboard) Object.defineProperty(navigator, "clipboard", previousClipboard)
    else Reflect.deleteProperty(navigator, "clipboard")
  }
})

test.each([String.raw`\\?\C:\projects\alwith-u`, String.raw`\\?\UNC\server\share\alwith-u`])(
  "Windows breadcrumbs use relative paths and reveal the real folder for %s",
  async (root) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32")
    const normalizedRoot = normalizePath(root)
    adapter = createMemoryAdapter({ [`${normalizedRoot}/folder/bunfig.toml`]: "content" })
    authorize = () => Promise.resolve(root)
    render(<Surface cwd={root} />)
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
    const project = await screen.findByRole("treeitem", { name: /alwith-u/ })
    fireEvent.click(project)
    fireEvent.keyDown(project, { key: "ArrowRight" })
    const folder = await screen.findByRole("treeitem", { name: /folder/ })
    fireEvent.click(folder)
    fireEvent.keyDown(folder, { key: "ArrowRight" })
    fireEvent.click(await screen.findByRole("treeitem", { name: /bunfig.toml/ }))
    await screen.findByRole("textbox", { name: "Code" })
    const breadcrumbs = screen.getByRole("navigation", { name: "File path" })
    expect(
      within(breadcrumbs)
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["folder", "bunfig.toml"])
    expect(breadcrumbs).toHaveAttribute("title", `${normalizedRoot}/folder/bunfig.toml`)
    native.invoke.mockClear()
    fireEvent.click(within(breadcrumbs).getByRole("button", { name: "folder" }))
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        `${FS}workspace_read_directory`,
        expect.objectContaining({ root, path: normalizedRoot })
      )
    )
    await waitFor(() =>
      expect(screen.getByRole("treeitem", { name: /folder/ })).toHaveAttribute("aria-selected", "true")
    )
  }
)

test("right workspace edits, renames and saves through installed packages", async () => {
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.click(await screen.findByRole("treeitem", { name: /one.txt/ }))
  expect(document.querySelector(".file-workspace-panel > header")).toBeNull()
  expect(document.body).toContainOneByRole("button", { name: "Hide file tree" })
  const code = await screen.findByRole("textbox", { name: "Code" })
  fireEvent.change(code, { target: { value: "edited" } })
  fireEvent.contextMenu(screen.getByRole("treeitem", { name: "one.txt" }))
  fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }))
  const name = await screen.findByRole("textbox", { name: "Rename" })
  fireEvent.change(name, { target: { value: "renamed.txt" } })
  fireEvent.keyDown(name, { key: "Enter" })
  await waitFor(() => expect(document.body).toContainOneByRole("tab", { name: "renamed.txt •" }))
  expect(
    within(required(document.querySelector<HTMLElement>(".alwith-editor-toolbar"))).queryByRole("button", {
      name: "More actions"
    })
  ).toBeNull()
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Code" }), { key: "s", metaKey: true })
  await waitFor(() => expect(document.body).toContainOneByRole("tab", { name: "renamed.txt" }))
  expect(new TextDecoder().decode(await adapter.readFile("/a/renamed.txt"))).toBe("edited")
  expect(await adapter.stat("/a/one.txt")).toBeNull()
  expect(document.body).toContainOneByText("Chat /a")
})

test("an old authorization response cannot open another chat's workspace", async () => {
  let finish!: (value: string) => void
  authorize = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const view = render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith(`${FS}workspace_open`, { path: "/a" }))
  view.rerender(<Surface cwd="/b" />)
  await act(() => {
    return Promise.try(() => {
      finish("/a")
    })
  })
  expect(screen.queryByRole("tree")).toBeNull()
  authorize = null
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  await screen.findByRole("treeitem", { name: /two.txt/ })
  expect(screen.queryByRole("treeitem", { name: /one.txt/ })).toBeNull()
})

test("switching projects retains unsaved documents and cancelling close retains edits", async () => {
  const view = render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.click(await screen.findByRole("treeitem", { name: /one.txt/ }))
  fireEvent.change(await screen.findByRole("textbox", { name: "Code" }), { target: { value: "draft" } })
  view.rerender(<Surface cwd="/b" />)
  await screen.findByRole("treeitem", { name: /two.txt/ })
  view.rerender(<Surface cwd="/a" />)
  await waitFor(() => expect(document.body).toContainOneByDisplayValue("draft"))
  fireEvent.click(screen.getByRole("button", { name: "Close one.txt" }))
  await screen.findByRole("dialog")
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect(document.body).toContainOneByDisplayValue("draft")
  expect(new TextDecoder().decode(await adapter.readFile("/a/one.txt"))).toBe("first")
})

test("native dirty state follows the aggregate across workspace switches", async () => {
  const view = render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.click(await screen.findByRole("treeitem", { name: /one.txt/ }))
  fireEvent.change(await screen.findByRole("textbox", { name: "Code" }), { target: { value: "changed a" } })
  view.rerender(<Surface cwd="/b" />)
  fireEvent.click(await screen.findByRole("treeitem", { name: /two.txt/ }))
  await screen.findByRole("textbox", { name: "Code" })
  view.rerender(<Surface cwd="/a" />)
  await waitFor(() => expect(document.body).toContainOneByDisplayValue("changed a"))
  expect(
    within(required(document.querySelector<HTMLElement>(".alwith-editor-toolbar"))).queryByRole("button", {
      name: "More actions"
    })
  ).toBeNull()
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Code" }), { key: "s", metaKey: true })
  await waitFor(() => expect(document.body).toContainOneByRole("tab", { name: "one.txt" }))
  view.rerender(<Surface cwd="/b" />)
  await waitFor(() => expect(document.body).toContainOneByDisplayValue("second"))
  fireEvent.change(screen.getByRole("textbox", { name: "Code" }), { target: { value: "changed b" } })
  const notifications = native.invoke.mock.calls.filter(([command]) => command === "workspace_dirty")
  expect(notifications.at(-1)).toEqual(["workspace_dirty", { dirty: true }])
})

function requestExit(): void {
  required(native.listen.mock.calls.find(([name]) => name === "workspace:shutdown")?.[1])()
}

test("main-window close is left to the resident host without prompting or approving exit", async () => {
  native.nativeMode = true
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.doubleClick(await screen.findByRole("treeitem", { name: "one.txt" }))
  fireEvent.change(await screen.findByRole("textbox", { name: "Code" }), { target: { value: "kept in memory" } })
  expect(native.close).toBeNull()
  expect(screen.queryByRole("dialog")).toBeNull()
  expect(native.invoke).not.toHaveBeenCalledWith("workspace_exit")
  expect(screen.getByRole("textbox", { name: "Code" })).toHaveValue("kept in memory")
})

test("discarding on explicit quit takes the approved native exit path", async () => {
  native.nativeMode = true
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.click(await screen.findByRole("treeitem", { name: /one.txt/ }))
  fireEvent.change(await screen.findByRole("textbox", { name: "Code" }), { target: { value: "draft" } })
  expect(native.close).toBeNull()
  await act(() => Promise.try(() => requestExit()))
  fireEvent.click(await screen.findByRole("button", { name: "Discard" }))
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("workspace_exit"))
  expect(new TextDecoder().decode(await adapter.readFile("/a/one.txt"))).toBe("first")
})

test("preview controls switch view mode and retain edits across hiding", async () => {
  render(<Surface cwd="/a" />)
  expect(screen.queryByRole("button", { name: "Maximize" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.click(await screen.findByRole("treeitem", { name: /one.txt/ }))
  fireEvent.change(await screen.findByRole("textbox", { name: "Code" }), { target: { value: "retained draft" } })
  expect(screen.getByRole("button", { name: "Maximize" }).querySelector(".lucide-maximize-2")).not.toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Maximize" }))
  const chat = required(document.querySelector(".file-workspace-chat"))
  expect(chat.querySelector("header")).toHaveTextContent("Conversation")
  expect(chat.closest(".file-workspace-slide")).toHaveAttribute("aria-hidden", "true")
  expect(chat.closest(".file-workspace-slide")).toHaveAttribute("inert")
  expect(document.querySelector(".alwith-workspace-tabbar")).toContainOneByRole("button", {
    name: "Restore"
  })
  const titlebar = within(screen.getByTestId("window-titlebar"))
  expect(titlebar.getByRole("button", { name: "Open workspace" })).toHaveAttribute("aria-expanded", "true")
  const layout = document.querySelector(".file-workspace-layout")
  expect(layout).toHaveAttribute("data-view-mode", "true")
  fireEvent.click(titlebar.getByRole("button", { name: "Open workspace" }))
  expect(layout).toHaveAttribute("data-view-mode", "false")
  expect(chat.closest(".file-workspace-slide")).toHaveAttribute("aria-hidden", "false")
  expect(chat.closest(".file-workspace-slide")).not.toHaveAttribute("inert")
  const tree = screen.getByRole("tree")
  const editor = screen.getByRole("textbox", { name: "Code" })
  expect(editor.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  fireEvent.click(screen.getByRole("button", { name: "Maximize" }))
  fireEvent.click(screen.getByRole("button", { name: "Restore" }))
  expect(layout).toHaveAttribute("data-view-mode", "false")
  fireEvent.click(screen.getByRole("button", { name: "Maximize" }))
  fireEvent.click(
    within(required(document.querySelector(".workspace-tab-host"))).getByRole("button", { name: "Close workspace" })
  )
  expect(screen.queryByRole("button", { name: "Maximize" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  await waitFor(() => expect(document.body).toContainOneByDisplayValue("retained draft"))
  expect(layout).toHaveAttribute("data-view-mode", "false")
})

test("chat reveal requests restore the chat pane without closing the preview or losing edits", async () => {
  const view = render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.click(await screen.findByRole("treeitem", { name: "one.txt" }))
  fireEvent.change(await screen.findByRole("textbox", { name: "Code" }), { target: { value: "retained draft" } })
  fireEvent.click(screen.getByRole("button", { name: "Maximize" }))
  const layout = required(document.querySelector(".file-workspace-layout"))
  expect(layout).toHaveAttribute("data-view-mode", "true")
  view.rerender(<Surface cwd="/a" />)
  expect(layout).toHaveAttribute("data-view-mode", "true")
  view.rerender(<Surface cwd="/a" chatRevealRequest={1} />)
  await waitFor(() => expect(layout).toHaveAttribute("data-view-mode", "false"))
  expect(screen.getByText("Chat /a")).toBeVisible()
  expect(screen.getByRole("textbox", { name: "Code" })).toHaveValue("retained draft")
  expect(screen.getByRole("button", { name: "Close workspace", expanded: true })).toHaveAttribute(
    "aria-expanded",
    "true"
  )
})

test("Desktop-style context menu, inline rename cancellation, and search keyboard controls", async () => {
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  const row = await screen.findByRole("treeitem", { name: /one.txt/ })
  fireEvent.contextMenu(row)
  const rename = await screen.findByRole("menuitem", { name: "Rename" })
  fireEvent.click(rename)
  const input = await screen.findByRole("textbox", { name: "Rename" })
  fireEvent.change(input, { target: { value: "cancelled.txt" } })
  fireEvent.keyDown(input, { key: "Escape" })
  expect(await adapter.stat("/a/one.txt")).not.toBeNull()
  expect(await adapter.stat("/a/cancelled.txt")).toBeNull()
  fireEvent.keyDown(screen.getByRole("tree"), { key: "f", metaKey: true })
  const search = await screen.findByRole("textbox", { name: "Filter loaded files" })
  fireEvent.change(search, { target: { value: "missing" } })
  expect(screen.queryByRole("treeitem", { name: /one.txt/ })).toBeNull()
  fireEvent.keyDown(search, { key: "Escape" })
  expect(document.body).toContainOneByRole("treeitem", { name: /one.txt/ })
})

test("tree toolbar creates folders and files, searches, refreshes and collapses", async () => {
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  await screen.findByRole("treeitem", { name: "one.txt" })
  fireEvent.click(screen.getByRole("button", { name: "New folder" }))
  fireEvent.change(await screen.findByRole("textbox", { name: "New folder" }), { target: { value: "reports" } })
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
  const folder = await screen.findByRole("treeitem", { name: "reports" })
  fireEvent.click(folder)
  fireEvent.click(screen.getByRole("button", { name: "New file" }))
  fireEvent.change(await screen.findByRole("textbox", { name: "New file" }), { target: { value: "report.txt" } })
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
  expect(await screen.findByRole("tab", { name: "report.txt" })).toBeVisible()
  expect(await adapter.stat("/a/reports/report.txt")).not.toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Search files" }))
  fireEvent.change(await screen.findByRole("textbox", { name: "Filter loaded files" }), {
    target: { value: "report.txt" }
  })
  expect(screen.queryByRole("treeitem", { name: "one.txt" })).toBeNull()
  expect(screen.getByRole("treeitem", { name: "report.txt" })).toBeVisible()
  fireEvent.click(screen.getByRole("button", { name: "Close search" }))
  await adapter.writeFile("/a/external.txt", new TextEncoder().encode("external"), { mode: "create" })
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
  expect(await screen.findByRole("treeitem", { name: "external.txt" })).toBeVisible()
  fireEvent.click(screen.getByRole("button", { name: "Collapse all" }))
  expect(screen.queryByRole("treeitem", { name: "report.txt" })).toBeNull()
  expect(screen.getByRole("tab", { name: "report.txt" })).toBeVisible()
})

test("tree context menu copies and pastes a file, then deletes only the copy", async () => {
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.contextMenu(await screen.findByRole("treeitem", { name: "one.txt" }))
  fireEvent.click(await screen.findByRole("menuitem", { name: "Copy" }))
  fireEvent.contextMenu(screen.getByRole("treeitem", { name: "a" }))
  fireEvent.click(await screen.findByRole("menuitem", { name: "Paste" }))
  const copy = await screen.findByRole("treeitem", { name: "one copy.txt" })
  expect(new TextDecoder().decode(await adapter.readFile("/a/one copy.txt"))).toBe("first")
  fireEvent.contextMenu(copy)
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }))
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
  await waitFor(() => expect(screen.queryByRole("treeitem", { name: "one copy.txt" })).toBeNull())
  expect(await adapter.stat("/a/one.txt")).not.toBeNull()
  expect(await adapter.stat("/a/one copy.txt")).toBeNull()
})

test("the Windows tree reveal menu sends a Shell path instead of a verbatim path", async () => {
  const root = String.raw`\\?\C:\Users\finture\YUP Drive\我的空间\项目\专项分析`
  const normalized = normalizePath(root)
  adapter = createMemoryAdapter({ [`${normalized}/report.md`]: "report" })
  authorize = () => Promise.resolve(root)
  const reveal = vi.spyOn(opener, "revealItemsInDir").mockResolvedValue()
  render(<Surface cwd={root} />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.contextMenu(await screen.findByRole("treeitem", { name: "专项分析" }))
  fireEvent.click(await screen.findByRole("menuitem", { name: "Reveal in file manager" }))
  await waitFor(() =>
    expect(reveal).toHaveBeenCalledExactlyOnceWith(String.raw`C:\Users\finture\YUP Drive\我的空间\项目\专项分析`)
  )
})

test("reopening the preview reuses the authorized workspace", async () => {
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  await screen.findByRole("treeitem", { name: /one.txt/ })
  fireEvent.click(screen.getByRole("button", { name: "Close workspace", expanded: true }))
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  await screen.findByRole("treeitem", { name: /one.txt/ })
  expect(native.invoke.mock.calls.filter(([command]) => command === `${FS}workspace_open`)).toHaveLength(1)
})

test("rapid preview clicks share one pending authorization", async () => {
  let finish!: (value: string) => void
  authorize = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  render(<Surface cwd="/a" />)
  const open = screen.getByRole("button", { name: "Open workspace" })
  fireEvent.click(open)
  fireEvent.click(open)
  await waitFor(() =>
    expect(native.invoke.mock.calls.filter(([command]) => command === `${FS}workspace_open`)).toHaveLength(1)
  )
  await act(() => {
    return Promise.try(() => {
      finish("/a")
    })
  })
  await screen.findByRole("treeitem", { name: /one.txt/ })
  expect(native.invoke.mock.calls.filter(([command]) => command === `${FS}workspace_open`)).toHaveLength(1)
})

// A drag suppresses its trailing click, but must not swallow the next root click.
test("root remains clickable after cancelling a pointer drag outside the tree", async () => {
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  const file = await screen.findByRole("treeitem", { name: "one.txt" })
  fireEvent(file, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
  fireEvent(document, new MouseEvent("pointermove", { bubbles: true, clientX: 30, clientY: 30 }))
  fireEvent(document, new MouseEvent("pointerup", { bubbles: true }))
  const root = screen.getByRole("treeitem", { name: "a" })
  fireEvent(root, new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
  fireEvent.click(root)
  await waitFor(() => expect(root).toHaveAttribute("aria-expanded", "false"))
  expect(screen.queryByRole("treeitem", { name: "one.txt" })).toBeNull()
})

test("explorer icon toggles the tree while preserving the open document and selection", async () => {
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.click(await screen.findByRole("treeitem", { name: "one.txt" }))
  await screen.findByRole("textbox", { name: "Code" })
  fireEvent.click(screen.getByRole("button", { name: "Hide file tree" }))
  expect(document.querySelector(".file-workspace-tree")).toHaveAttribute("data-collapsed", "true")
  expect(document.body).toContainOneByRole("tab", { name: "one.txt" })
  fireEvent.click(screen.getByRole("button", { name: "Show file tree" }))
  expect(screen.getByRole("treeitem", { name: "one.txt" })).toHaveAttribute("aria-selected", "true")
  expect(screen.getByRole("navigation", { name: "File path" })).toHaveAttribute("title", "/a/one.txt")
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull()
})

test("more than twelve pinned files retain every tab and reload deferred content", async () => {
  adapter = createMemoryAdapter(
    Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`/a/file${index}.txt`, `body ${index}`]))
  )
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  for (let index = 0; index < 14; index++) {
    fireEvent.doubleClick(await screen.findByRole("treeitem", { name: `file${index}.txt` }))
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Code" })).toHaveValue(`body ${index}`))
  }
  expect(screen.getAllByRole("tab")).toHaveLength(14)
  fireEvent.click(screen.getByRole("tab", { name: "file0.txt" }))
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Code" })).toHaveValue("body 0"))
  expect(screen.getAllByRole("tab")).toHaveLength(14)
}, 20000)

test("cancelled close-others keeps the dirty document and remaining tabs", async () => {
  await adapter.writeFile("/a/two.txt", new TextEncoder().encode("second"), { mode: "create" })
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.doubleClick(await screen.findByRole("treeitem", { name: "one.txt" }))
  await screen.findByRole("textbox", { name: "Code" })
  fireEvent.doubleClick(screen.getByRole("treeitem", { name: "two.txt" }))
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Code" })).toHaveValue("second"))
  fireEvent.change(screen.getByRole("textbox", { name: "Code" }), { target: { value: "unsaved" } })
  fireEvent.contextMenu(screen.getByRole("tab", { name: "one.txt" }))
  fireEvent.click(await screen.findByRole("menuitem", { name: "Close others" }))
  await screen.findByRole("dialog")
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect(screen.getAllByRole("tab")).toHaveLength(2)
  expect(screen.getByRole("textbox", { name: "Code" })).toHaveValue("unsaved")
})

test("tab strip accepts horizontal trackpad and vertical wheel scrolling", async () => {
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.click(await screen.findByRole("treeitem", { name: "one.txt" }))
  const tabs = required(document.querySelector<HTMLElement>(".alwith-workspace-tab-scroll"))
  Object.defineProperties(tabs, { scrollWidth: { value: 800 }, clientWidth: { value: 200 } })
  fireEvent.wheel(tabs, { deltaX: 60, deltaY: 0 })
  expect(tabs.scrollLeft).toBe(60)
  fireEvent.wheel(tabs, { deltaX: 0, deltaY: 40 })
  expect(tabs.scrollLeft).toBe(100)
  fireEvent.wheel(tabs, { deltaY: 40, ctrlKey: true })
  expect(tabs.scrollLeft).toBe(100)
})

test("Desktop keyboard navigation accumulates shift selection and Home only changes focus", async () => {
  adapter = createMemoryAdapter({ "/a/alpha.txt": "a", "/a/beta.txt": "b", "/a/gamma.txt": "c" })
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.click(await screen.findByRole("treeitem", { name: "alpha.txt" }))
  await screen.findByRole("tab", { name: "alpha.txt" })
  const tree = screen.getByRole("tree")
  fireEvent.keyDown(tree, { key: "ArrowDown", shiftKey: true })
  fireEvent.keyDown(tree, { key: "ArrowDown", shiftKey: true })
  fireEvent.keyDown(tree, { key: "ArrowUp", shiftKey: true })
  for (const name of ["alpha.txt", "beta.txt", "gamma.txt"]) {
    expect(screen.getByRole("treeitem", { name })).toHaveAttribute("aria-selected", "true")
  }
  fireEvent.keyDown(tree, { key: "Home" })
  expect(screen.getByRole("treeitem", { name: "a" })).toHaveAttribute("aria-selected", "false")
  expect(tree.getAttribute("aria-activedescendant")).toBe(screen.getByRole("treeitem", { name: "a" }).id)
})

test("Desktop root context menu omits rename, copy and delete", async () => {
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.contextMenu(await screen.findByRole("treeitem", { name: "a" }))
  await screen.findByRole("menu")
  for (const name of ["Rename", "Copy", "Delete"]) expect(screen.queryByRole("menuitem", { name })).toBeNull()
})

test("double-click both keeps a preview and references it in the registered conversation", async () => {
  adapter = createMemoryAdapter({ "/a/one.txt": "first", "/a/two.txt": "second" })
  const add = vi.fn()
  function ComposerTarget() {
    const register = useWorkspace()?.registerFileReference
    useLayoutEffect(() => register?.({ sessionId: "current-chat", add }), [register])
    return null
  }
  render(
    <Surface cwd="/a">
      <ComposerTarget />
    </Surface>
  )
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  const row = await screen.findByRole("treeitem", { name: "one.txt" })
  fireEvent.click(row)
  await screen.findByRole("tab", { name: "one.txt" })
  expect(screen.getByRole("tab", { name: "one.txt" }).closest("[data-transient]")).toHaveAttribute(
    "data-transient",
    "true"
  )
  expect(add).not.toHaveBeenCalled()
  fireEvent.doubleClick(row)
  expect(add).toHaveBeenCalledExactlyOnceWith("/a/one.txt")
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "one.txt" }).closest("[data-transient]")).toHaveAttribute(
      "data-transient",
      "false"
    )
  )
  fireEvent.click(screen.getByRole("treeitem", { name: "two.txt" }))
  await screen.findByRole("tab", { name: "two.txt" })
  expect(screen.getByRole("tab", { name: "one.txt" })).toBeInTheDocument()
})

test("single-click replaces a clean preview, double-click pins it, and editing pins it", async () => {
  adapter = createMemoryAdapter({ "/a/alpha.txt": "a", "/a/beta.txt": "b", "/a/gamma.txt": "c" })
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.click(await screen.findByRole("treeitem", { name: "alpha.txt" }))
  await screen.findByRole("tab", { name: "alpha.txt" })
  fireEvent.click(screen.getByRole("treeitem", { name: "beta.txt" }))
  await screen.findByRole("tab", { name: "beta.txt" })
  await waitFor(() => expect(screen.queryByRole("tab", { name: "alpha.txt" })).toBeNull())
  fireEvent.doubleClick(screen.getByRole("treeitem", { name: "beta.txt" }))
  fireEvent.click(screen.getByRole("treeitem", { name: "alpha.txt" }))
  fireEvent.change(await screen.findByDisplayValue("a"), { target: { value: "edited" } })
  fireEvent.click(screen.getByRole("treeitem", { name: "gamma.txt" }))
  await screen.findByRole("tab", { name: "gamma.txt" })
  expect(document.body).toContainOneByRole("tab", { name: "beta.txt" })
  expect(document.body).toContainOneByRole("tab", { name: "alpha.txt •" })
})

test("workspace switch opens and closes the preview while retaining the chat", async () => {
  render(<Surface cwd="/a" />)
  const closed = screen.getByRole("button", { name: "Open workspace" })
  expect(closed).toHaveAttribute("aria-expanded", "false")
  expect(closed).toHaveAttribute("aria-controls", "file-workspace-panel")
  fireEvent.click(closed)
  await screen.findByRole("treeitem", { name: "one.txt" })
  const opened = screen.getByRole("button", { name: "Close workspace", expanded: true })
  expect(opened).toHaveAttribute("aria-expanded", "true")
  fireEvent.click(opened)
  expect(screen.queryByRole("tree")).toBeNull()
  expect(screen.getByRole("button", { name: "Open workspace" })).toHaveAttribute("aria-expanded", "false")
  expect(screen.getByText("Chat /a")).toBeVisible()
})

test("row drag prevents native text selection without blocking inline rename input", async () => {
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  const file = await screen.findByRole("treeitem", { name: "one.txt" })
  const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 })
  fireEvent(file, down)
  expect(down.defaultPrevented).toBe(true)
  fireEvent(document, new MouseEvent("pointerup", { bubbles: true }))
  fireEvent.contextMenu(file)
  fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }))
  const input = await screen.findByRole("textbox", { name: "Rename" })
  const renameDown = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 })
  fireEvent(input, renameDown)
  expect(renameDown.defaultPrevented).toBe(false)
})

test("unmount releases a watch that finishes after workspace creation is cancelled", async () => {
  let completeWatch: (() => void) | null = null
  const pendingWatch = new Promise<void>((resolve) => {
    completeWatch = resolve
  })
  const originalInvoke = required(native.invoke.getMockImplementation())
  native.invoke.mockImplementation(async (command: string, args: { enabled?: boolean }) => {
    if (command === `${FS}workspace_watch` && args.enabled) {
      await pendingWatch
      return null
    }
    return originalInvoke(command, args) as unknown
  })
  const view = render(
    <StrictMode>
      <Surface cwd="/a" />
    </StrictMode>
  )
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith(`${FS}workspace_watch`, { root: "/a", enabled: true }))
  view.unmount()
  await act(async () => {
    required(completeWatch)()
    await pendingWatch
  })
  await waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith(`${FS}workspace_watch`, { root: "/a", enabled: false })
  )
  expect(localStorage.getItem("workspace:/a")).toBeNull()
  expect(native.invoke.mock.calls.filter(([command]) => command === "workspace_dirty")).toHaveLength(0)

  // StrictMode's cleanup must not leave subsequent mounts with an aborted lifetime.
  render(
    <StrictMode>
      <Surface cwd="/a" />
    </StrictMode>
  )
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  expect(await screen.findByRole("treeitem", { name: "one.txt" })).toBeInTheDocument()
})

test("cancelling application exit keeps the dirty document editable and allows a later exit", async () => {
  native.nativeMode = true
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.doubleClick(await screen.findByRole("treeitem", { name: "one.txt" }))
  fireEvent.change(await screen.findByRole("textbox", { name: "Code" }), { target: { value: "unsaved" } })
  await act(() => Promise.try(() => requestExit()))
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect(native.invoke.mock.calls.filter(([command]) => command === "workspace_exit")).toHaveLength(0)
  expect(screen.getByRole("textbox", { name: "Code" })).toHaveValue("unsaved")
  fireEvent.change(screen.getByRole("textbox", { name: "Code" }), { target: { value: "continued editing" } })
  await act(() => Promise.try(() => requestExit()))
  fireEvent.click(await screen.findByRole("button", { name: "Save" }))
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("workspace_exit"))
  expect(new TextDecoder().decode(await adapter.readFile("/a/one.txt"))).toBe("continued editing")
})

test("saving on exit succeeds when the saved background document is deferred", async () => {
  native.nativeMode = true
  adapter = createMemoryAdapter(
    Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`/a/file${index}.txt`, `body ${index}`]))
  )
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.doubleClick(await screen.findByRole("treeitem", { name: "file0.txt" }))
  fireEvent.change(await screen.findByRole("textbox", { name: "Code" }), { target: { value: "saved on exit" } })
  for (let index = 1; index < 14; index++) {
    fireEvent.doubleClick(screen.getByRole("treeitem", { name: `file${index}.txt` }))
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Code" })).toHaveValue(`body ${index}`))
  }
  await act(() => {
    return Promise.try(() => {
      requestExit()
    })
  })
  fireEvent.click(await screen.findByRole("button", { name: "Save" }))
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("workspace_exit"))
  expect(new TextDecoder().decode(await adapter.readFile("/a/file0.txt"))).toBe("saved on exit")
}, 20000)

test("edits to an approved project while another exit prompt is open prevent exit", async () => {
  native.nativeMode = true
  const view = render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.doubleClick(await screen.findByRole("treeitem", { name: "one.txt" }))
  fireEvent.change(await screen.findByRole("textbox", { name: "Code" }), { target: { value: "first draft" } })
  view.rerender(<Surface cwd="/b" />)
  fireEvent.doubleClick(await screen.findByRole("treeitem", { name: "two.txt" }))
  fireEvent.change(await screen.findByRole("textbox", { name: "Code" }), { target: { value: "second draft" } })
  await act(() => {
    return Promise.try(() => {
      requestExit()
    })
  })
  fireEvent.click(await screen.findByRole("button", { name: "Discard" }))
  await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("/b/two.txt"))
  view.rerender(<Surface cwd="/a" />)
  await waitFor(() =>
    expect(required(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Code"]'))).toHaveValue(
      "first draft"
    )
  )
  fireEvent.change(required(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Code"]')), {
    target: { value: "changed after approval" }
  })
  fireEvent.click(screen.getByRole("button", { name: "Discard" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect(native.invoke.mock.calls.filter(([command]) => command === "workspace_exit")).toHaveLength(0)
  expect(screen.getByRole("textbox", { name: "Code" })).toHaveValue("changed after approval")
})

test("project tree shortcut opens the preview and reopens a collapsed tree without toggling it closed", async () => {
  render(<Surface cwd="/a" />)
  fireEvent.keyDown(window, { key: "E", ctrlKey: true, shiftKey: true })
  expect(await screen.findByRole("treeitem", { name: /one.txt/ })).toBeVisible()
  fireEvent.click(screen.getByRole("button", { name: "Hide file tree" }))
  expect(screen.getByRole("button", { name: "Show file tree" })).toHaveAttribute("aria-expanded", "false")
  fireEvent.keyDown(window, { key: "e", metaKey: true, shiftKey: true })
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Hide file tree" })).toHaveAttribute("aria-expanded", "true")
  )
  fireEvent.keyDown(window, { key: "E", ctrlKey: true, shiftKey: true })
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Hide file tree" })).toHaveAttribute("aria-expanded", "true")
  )
})

test("native project tree menu opens the current workspace", async () => {
  native.nativeMode = true
  render(<Surface cwd="/a" />)
  const calls = native.listen.mock.calls as unknown as [string, () => void][]
  const callback = calls.find(([name]) => name === "menu:project-tree")?.[1]
  expect(callback).toBeDefined()
  act(() => required(callback)())
  expect(await screen.findByRole("treeitem", { name: /one.txt/ })).toBeVisible()
})

test("project tree shortcut ignores a response belonging to a previous project", async () => {
  let finish!: (value: string) => void
  authorize = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const view = render(<Surface cwd="/a" />)
  fireEvent.keyDown(window, { key: "E", ctrlKey: true, shiftKey: true })
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith(`${FS}workspace_open`, { path: "/a" }))
  view.rerender(<Surface cwd="/b" />)
  await act(() => Promise.try(() => finish("/a")))
  expect(screen.queryByRole("tree")).toBeNull()
  authorize = null
  fireEvent.keyDown(window, { key: "E", ctrlKey: true, shiftKey: true })
  expect(await screen.findByRole("treeitem", { name: /two.txt/ })).toBeVisible()
  expect(screen.queryByRole("treeitem", { name: /one.txt/ })).toBeNull()
})

test("new tabs keep the existing preview, support middle close and restore their selection", async () => {
  await adapter.writeFile("/a/two.txt", new TextEncoder().encode("second"), { mode: "create" })
  const view = render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  expect(await screen.findByRole("tab", { name: "New tab" })).toHaveAttribute("aria-selected", "true")
  expect(screen.getByRole("button", { name: "Discover ALwith U ALwith U Guide" })).toBeVisible()
  fireEvent.click(screen.getByRole("treeitem", { name: "one.txt" }))
  await screen.findByRole("tab", { name: "one.txt" })
  fireEvent.click(screen.getByRole("button", { name: "New tab" }))
  fireEvent.click(screen.getByRole("treeitem", { name: "two.txt" }))
  await screen.findByRole("tab", { name: "two.txt" })
  expect(screen.getByRole("tab", { name: "one.txt" })).toBeVisible()
  expect(screen.queryByRole("tab", { name: "New tab" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "New tab" }))
  await waitFor(() =>
    expect(
      (JSON.parse(required(localStorage.getItem("workspace:/a"))) as { tabLayout: { activeIndex: number } }).tabLayout
        .activeIndex
    ).toBe(2)
  )
  view.unmount()
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  expect(await screen.findByRole("tab", { name: "New tab" })).toHaveAttribute("aria-selected", "true")
  fireEvent(screen.getByRole("tab", { name: "New tab" }), new MouseEvent("auxclick", { bubbles: true, button: 1 }))
  await waitFor(() => expect(screen.queryByRole("tab", { name: "New tab" })).toBeNull())
  expect(screen.getByRole("tab", { name: "two.txt" })).toHaveAttribute("aria-selected", "true")
})

test("the new-tab card opens the ALwith U guide", async () => {
  vi.mocked(openGuideWindow).mockResolvedValueOnce()
  render(<Surface cwd="/a" />)
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
  fireEvent.click(await screen.findByRole("button", { name: "Discover ALwith U ALwith U Guide" }))
  await waitFor(() => expect(openGuideWindow).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole("dialog")).toBeNull()
})

test("workspace keyboard shortcuts open, close and reopen a file without losing its contents", async () => {
  render(<Surface cwd="/a" />)
  fireEvent.keyDown(window, { key: "t", metaKey: true })
  expect(await screen.findByRole("tab", { name: "New tab" })).toHaveAttribute("aria-selected", "true")
  fireEvent.click(await screen.findByRole("treeitem", { name: "one.txt" }))
  await screen.findByRole("tab", { name: "one.txt" })
  fireEvent.keyDown(window, { key: "w", metaKey: true })
  await waitFor(() => expect(screen.queryByRole("tab", { name: "one.txt" })).toBeNull())
  fireEvent.keyDown(window, { key: "t", metaKey: true, shiftKey: true })
  expect(await screen.findByRole("textbox", { name: "Code" })).toHaveValue("first")
  expect(screen.getByRole("tab", { name: "one.txt" }).closest("[data-transient]")).toHaveAttribute(
    "data-transient",
    "false"
  )
})

test("native new-tab menu opens the workspace and close-tab preserves the chat", async () => {
  native.nativeMode = true
  render(<Surface cwd="/a" />)
  const handler = (): (() => void) => required(native.listen.mock.calls.find(([name]) => name === "menu:new-tab")?.[1])
  act(() => handler()())
  await screen.findByRole("tab", { name: "New tab" })
  const close = native.listen.mock.calls.findLast(([name]) => name === "menu:close-tab")?.[1]
  act(() => required(close)())
  await waitFor(() => expect(screen.queryByRole("tab")).toBeNull())
  expect(screen.getByText("Chat /a")).toBeInTheDocument()
  expect(native.invoke.mock.calls.some(([command]) => command === "workspace_exit")).toBe(false)
})

function canvasContext(overrides: Partial<DesktopCanvas> = {}): DesktopCanvas {
  return {
    viewportWidth: 1256,
    budget: 1000,
    region: "chat",
    trailingActive: false,
    moving: false,
    navigate: vi.fn(),
    ...overrides
  }
}

/** The main window: the shell's canvas and the layout's preview pane the file workspace fills. */
function Unified({
  canvas,
  slot,
  show = vi.fn(),
  children
}: {
  canvas: DesktopCanvas
  slot: HTMLElement
  show?: (state: { hidden: boolean; maximized: boolean }) => void
  children: ReactNode
}) {
  return (
    <CanvasContext.Provider value={canvas}>
      <PreviewPaneContext.Provider value={{ slot, show }}>{children}</PreviewPaneContext.Provider>
    </CanvasContext.Provider>
  )
}

test("chat reveal navigates the unified canvas back from the preview", async () => {
  const navigate = vi.fn()
  const slot = document.createElement("div")
  document.body.append(slot)
  const context = canvasContext({ navigate })
  const surface = (request: number) => (
    <Unified canvas={context} slot={slot}>
      <Surface cwd="/a" chatRevealRequest={request} />
    </Unified>
  )
  try {
    const view = render(surface(0))
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith("preview"))
    context.region = "preview"
    view.rerender(surface(0))
    fireEvent.click(await screen.findByRole("button", { name: "Maximize" }))
    view.rerender(surface(1))
    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith("chat"))
    view.unmount()
  } finally {
    slot.remove()
  }
})

test("the preview renders in the layout's preview pane and reports how the pane is shown", async () => {
  const show = vi.fn()
  const slot = document.createElement("div")
  document.body.append(slot)
  try {
    const view = render(
      <Unified canvas={canvasContext()} slot={slot} show={show}>
        <Surface cwd="/a" />
      </Unified>
    )
    expect(show).toHaveBeenLastCalledWith({ hidden: true, maximized: false })
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }))
    fireEvent.click(await within(slot).findByRole("treeitem", { name: "one.txt" }))
    fireEvent.change(await within(slot).findByRole("textbox", { name: "Code" }), { target: { value: "retained edit" } })
    expect(show).toHaveBeenLastCalledWith({ hidden: false, maximized: false })
    fireEvent.click(screen.getByRole("button", { name: "Close workspace", expanded: true }))
    expect(show).toHaveBeenLastCalledWith({ hidden: true, maximized: false })
    expect(screen.getByRole("button", { name: "Open workspace" })).toHaveAttribute("aria-expanded", "false")
    view.unmount()
  } finally {
    slot.remove()
  }
})

test("Windows workspace controls follow the actual canvas screen without resetting workspace state", async () => {
  const target = document.createElement("div")
  const slot = document.createElement("div")
  document.body.append(target, slot)
  const context = canvasContext()
  const layout = (region: DesktopCanvas["region"]) => (
    <Unified canvas={{ ...context, region }} slot={slot}>
      <WindowsWorkspaceControlsContext.Provider value={target}>
        <Surface cwd="/a" />
      </WindowsWorkspaceControlsContext.Provider>
    </Unified>
  )
  try {
    const view = render(layout("chat"))
    fireEvent.click(within(target).getByRole("button", { name: "Open workspace" }))
    fireEvent.click(await within(slot).findByRole("treeitem", { name: "one.txt" }))
    fireEvent.change(await within(slot).findByRole("textbox", { name: "Code" }), {
      target: { value: "retained across screens" }
    })
    for (const region of ["leading", "trailing", "preview", "leading", "chat"] as const) {
      view.rerender(layout(region))
      if (region === "chat" || region === "preview")
        expect(within(target).getByRole("button", { name: "Close workspace" })).toHaveAttribute("aria-expanded", "true")
      else expect(target).toBeEmptyDOMElement()
    }
    expect(within(slot).getByRole("textbox", { name: "Code" })).toHaveValue("retained across screens")
    view.unmount()
  } finally {
    target.remove()
    slot.remove()
  }
})
