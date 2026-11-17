import "./language"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"

import { BrowserWorkspace } from "../browser-workspace"

const { listeners, commands, metas, offered } = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  commands: [] as string[],
  /** What each pane is given of the other tabs, and its way to one of them. */
  offered: new Map<string, { pages: readonly { url: string }[]; go?: (url: string) => void }>(),
  metas: new Map<string, ((meta: Record<string, unknown>) => void) | undefined>()
}))
const { toast, reveal } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  reveal: vi.fn(async () => {})
}))
vi.mock("../browser-quick-chat", () => ({ BrowserQuickChat: () => null }))
vi.mock("sonner", () => ({ toast }))
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemsInDir: reveal }))
const nativeWindow = vi.hoisted(() => ({
  fullscreen: false,
  isFullscreen: vi.fn(async () => nativeWindow.fullscreen),
  setFullscreen: vi.fn(async (value: boolean) => {
    nativeWindow.fullscreen = value
  }),
  focus: undefined as ((event: { payload: boolean }) => void) | undefined,
  onFocusChanged: vi.fn(async (handler: (event: { payload: boolean }) => void) => {
    nativeWindow.focus = handler
    return () => {}
  })
}))
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => nativeWindow }))
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => (command === "web_automation_controls" ? {} : undefined)),
  isTauri: () => false
}))
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(name, handler)
    return () => listeners.delete(name)
  }
}))
// The desktop shell's zoom, as a level the test sets and actions it counts.
const shellZoom = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state = { level: 1 }
  return {
    state,
    listeners,
    set(level: number) {
      state.level = level
      for (const listener of listeners) listener()
    },
    zoomIn: vi.fn(async () => {}),
    zoomOut: vi.fn(async () => {}),
    reset: vi.fn(async () => {})
  }
})
vi.mock("@alwith/module-desktop-shell/react", async () => {
  const { useSyncExternalStore } = await import("react")
  return {
    useDesktopCanvas: () => null,
    useDesktopZoom: () => ({
      level: useSyncExternalStore(
        (listener) => {
          shellZoom.listeners.add(listener)
          return () => shellZoom.listeners.delete(listener)
        },
        () => shellZoom.state.level
      ),
      zoomIn: shellZoom.zoomIn,
      zoomOut: shellZoom.zoomOut,
      reset: shellZoom.reset
    })
  }
})
vi.mock("../browser-pane", async () => {
  const { useEffect, useImperativeHandle } = await import("react")
  return {
    BrowserPane: (props: {
      initialUrl?: string
      request?: { url: string; id: string }
      ref?: React.Ref<{ run: (command: string) => void }>
      onGuest?: (label: string) => void
      onMeta?: (meta: Record<string, unknown>) => void
      openPages?: readonly { url: string }[]
      onSwitchTab?: (url: string) => void
      initialHistory?: unknown
    }) => {
      metas.set(props.request?.url ?? props.initialUrl ?? "blank", props.onMeta)
      offered.set(props.request?.url ?? props.initialUrl ?? "blank", {
        pages: props.openPages ?? [],
        go: props.onSwitchTab
      })
      const url = props.request?.url ?? props.initialUrl
      useImperativeHandle(props.ref, () => ({ run: (command) => commands.push(`${url ?? "blank"}:${command}`) }))
      useEffect(() => {
        props.onGuest?.(`guest:${url ?? "blank"}`)
        if (url) props.onMeta?.({ url })
      }, [])
      return <p data-testid="pane">{url ?? "blank"}</p>
    }
  }
})
const props = { active: true, maximized: false, onMaximize: vi.fn(), onClose: vi.fn() }
const panes = () => screen.getAllByTestId("pane").map((pane) => pane.textContent)
const tabs = () => screen.getAllByRole("tab").map((tab) => tab.textContent)
const chord = (code: string, shiftKey = false) =>
  fireEvent.keyDown(screen.getByRole("region", { name: "网页工作区" }), { code, metaKey: true, shiftKey })
beforeEach(() => {
  localStorage.clear()
  listeners.clear()
  commands.length = 0
})

test("released AI pages retain their mounted pane and provenance group", async () => {
  render(
    <BrowserWorkspace {...props} request={{ id: "ai-release", url: "https://release.example/", sessionId: "a" }} />
  )
  expect(screen.getByRole("button", { name: "标签组 AI 1" })).toBeInTheDocument()
  const pane = screen.getByTestId("pane")
  await act(async () => listeners.get("browser-control-changed")!({ payload: {} }))
  expect(screen.getByRole("button", { name: "标签组 AI 1" })).toBeInTheDocument()
  expect(screen.getByTestId("pane")).toBe(pane)
  expect(screen.queryByLabelText("AI 会话标签")).toBeNull()
})

test("a closed page reopens where it was and an AI tab does not", () => {
  const view = render(<BrowserWorkspace {...props} request={{ id: "a", url: "https://a.example/" }} />)
  view.rerender(<BrowserWorkspace {...props} request={{ id: "ai", url: "https://ai.example/", sessionId: "s" }} />)
  chord("KeyW")
  expect(panes()).toEqual(["https://a.example/"])
  chord("KeyW")
  expect(screen.queryAllByTestId("pane")).toEqual([])
  chord("KeyT", true)
  expect(panes()).toEqual(["https://a.example/"])
  // Nothing else to bring back: the conversation's tab is not a closed page.
  chord("KeyT", true)
  expect(panes()).toEqual(["https://a.example/"])
})

test("saved tabs come back after a restart and load only when shown", () => {
  localStorage.setItem(
    "alwith.browser.tabs.v1",
    JSON.stringify({
      tabs: [
        { url: "https://one.example/", title: "One" },
        { url: "https://two.example/", title: "Two" },
        { url: "https://three.example/", title: "Three" }
      ],
      selected: 1
    })
  )
  render(<BrowserWorkspace {...props} />)
  expect(tabs()).toEqual(["One", "Two", "Three"])
  expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("aria-selected", "true")
  expect(panes()).toEqual(["https://two.example/"])
  chord("Digit9")
  expect(panes()).toEqual(["https://two.example/", "https://three.example/"])
  chord("BracketLeft", true)
  chord("BracketLeft", true)
  expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("aria-selected", "true")
  expect(panes()).toHaveLength(3)
})

test("grouped tabs come back behind their group's name, which puts them away and brings them back", () => {
  localStorage.setItem(
    "alwith.browser.tabs.v1",
    JSON.stringify({
      tabs: [
        { url: "https://one.example/", title: "One", group: 0 },
        { url: "https://two.example/", title: "Two", group: 0 },
        { url: "https://three.example/", title: "Three" }
      ],
      selected: 0,
      groups: [{ title: "Work", color: 2, collapsed: true }]
    })
  )
  render(<BrowserWorkspace {...props} />)
  // The tab in front is in the group, so the group is open whatever was saved.
  const chip = screen.getByRole("button", { name: "标签组 Work" })
  expect(chip).toHaveAttribute("aria-expanded", "true")
  expect(tabs()).toEqual(["One", "Two", "Three"])
  fireEvent.click(chip)
  expect(tabs()).toEqual(["Three"])
  expect(screen.getByRole("tab", { name: "Three" })).toHaveAttribute("aria-selected", "true")
  expect(JSON.parse(localStorage.getItem("alwith.browser.tabs.v1")!).groups).toEqual([
    { title: "Work", color: 2, collapsed: true }
  ])
  // Going to a tab that is put away opens its group.
  chord("Digit1")
  expect(tabs()).toEqual(["One", "Two", "Three"])
  // Closing the group's tabs takes the group with them.
  chord("KeyW")
  chord("KeyW")
  expect(screen.queryByRole("button", { name: "标签组 Work" })).toBeNull()
  expect(tabs()).toEqual(["Three"])
})

test("extensions are told through a tab when the window comes to the front or leaves it", async () => {
  const { invoke } = await import("@tauri-apps/api/core")
  render(<BrowserWorkspace {...props} request={{ id: "a", url: "https://a.example/" }} />)
  act(() => nativeWindow.focus?.({ payload: false }))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_window_focus", {
    label: "guest:https://a.example/",
    focused: false
  })
})

test("a tab is offered the pages open in the others and shows the one that is chosen", () => {
  localStorage.setItem(
    "alwith.browser.tabs.v1",
    JSON.stringify({
      tabs: [
        { url: "https://one.example/", title: "One" },
        { url: "https://two.example/", title: "Two" }
      ],
      selected: 0
    })
  )
  render(<BrowserWorkspace {...props} />)
  expect(offered.get("https://one.example/")?.pages).toEqual([{ url: "https://two.example/", title: "Two" }])
  act(() => offered.get("https://one.example/")!.go!("https://two.example/"))
  expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("aria-selected", "true")
  expect(tabs()).toEqual(["One", "Two"])
})

test("a closed tab reopens with the session history its browser last reported", () => {
  render(<BrowserWorkspace {...props} request={{ id: "a", url: "https://a.example/" }} />)
  const history = {
    entries: [
      { url: "https://a.example/", title: "A" },
      { url: "https://a.example/next", title: "Next" }
    ],
    shown: 0
  }
  act(() => metas.get("https://a.example/")!({ history }))
  expect(JSON.parse(localStorage.getItem("alwith.browser.tabs.v1")!).tabs[0].history).toEqual(history)
  chord("KeyW")
  chord("KeyT", true)
  expect(panes()).toEqual(["https://a.example/"])
})

test("the open tabs are saved as they change", () => {
  render(<BrowserWorkspace {...props} request={{ id: "a", url: "https://a.example/" }} />)
  expect(JSON.parse(localStorage.getItem("alwith.browser.tabs.v1")!)).toEqual({
    tabs: [{ url: "https://a.example/", title: "a.example" }],
    selected: 0
  })
  chord("KeyW")
  expect(localStorage.getItem("alwith.browser.tabs.v1")).toBeNull()
})

test("a page the browser opens for an extension becomes the selected tab, unless asked for behind it", async () => {
  const { invoke } = await import("@tauri-apps/api/core")
  const page = (url: string, background = false) => ({ url, background })
  // One was asked for before the pane showed; it is taken when the pane does.
  const waiting = [
    [page("https://early.example/")],
    [page("https://extension.example/welcome")],
    [page("https://behind.example/", true)]
  ]
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "cef_take_tab_requests"
      ? (waiting.shift() ?? [])
      : command === "web_automation_controls"
        ? {}
        : undefined
  )
  render(<BrowserWorkspace {...props} request={{ id: "a", url: "https://a.example/" }} />)
  await act(async () => {})
  expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("early.example")
  await act(async () => listeners.get("browser-open-tab")!({ payload: null }))
  expect(screen.getAllByRole("tab")).toHaveLength(3)
  expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("extension.example")
  // It loads where it was asked for; the user stays where they are.
  await act(async () => listeners.get("browser-open-tab")!({ payload: null }))
  expect(screen.getAllByRole("tab")).toHaveLength(4)
  expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("extension.example")
  expect(panes()).toContain("https://behind.example/")
  vi.mocked(invoke).mockImplementation(async (command) => (command === "web_automation_controls" ? {} : undefined))
})

test("a chord claimed inside a page acts on the tab it came from", async () => {
  const view = render(<BrowserWorkspace {...props} request={{ id: "a", url: "https://a.example/" }} />)
  view.rerender(<BrowserWorkspace {...props} request={{ id: "b", url: "https://b.example/" }} />)
  await act(async () => {})
  const shortcut = (label: string, command: string) =>
    act(() => listeners.get("browser-shortcut")!({ payload: { label, command } }))
  // The background tab asked, not the selected one.
  shortcut("guest:https://a.example/", "reload")
  expect(commands).toEqual(["https://a.example/:reload"])
  shortcut("guest:https://a.example/", "close-tab")
  expect(panes()).toEqual(["https://b.example/"])
  shortcut("guest:https://b.example/", "new-tab")
  expect(tabs()).toHaveLength(2)
  shortcut("guest:gone", "close-tab")
  expect(tabs()).toHaveLength(2)
})

test("toolbar chords reach the selected pane", () => {
  render(<BrowserWorkspace {...props} request={{ id: "a", url: "https://a.example/" }} />)
  chord("KeyL")
  chord("KeyR", true)
  chord("Period")
  expect(commands).toEqual([
    "https://a.example/:focus-address",
    "https://a.example/:hard-reload",
    "https://a.example/:stop"
  ])
  // An editing chord is not a browser command.
  expect(fireEvent.keyDown(screen.getByRole("region", { name: "网页工作区" }), { code: "KeyC", metaKey: true })).toBe(
    true
  )
})

test("pages follow the one interface zoom, and zoom chords drive that same zoom", async () => {
  const { invoke } = await import("@tauri-apps/api/core")
  const { zoomIn } = shellZoom
  zoomIn.mockClear()
  const calls = () =>
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "cef_set_guest_zoom")
      .map(([, args]) => args)
  render(<BrowserWorkspace {...props} request={{ id: "a", url: "https://a.example/" }} />)
  expect(calls().at(-1)).toEqual({ scaleFactor: 1 })
  act(() => shellZoom.set(1.5))
  expect(calls().at(-1)).toEqual({ scaleFactor: 1.5 })
  chord("Equal")
  chord("Equal", true)
  expect(zoomIn).toHaveBeenCalledTimes(2)
  await act(async () =>
    listeners.get("browser-shortcut")!({ payload: { label: "guest:https://a.example/", command: "zoom-in" } })
  )
  expect(zoomIn).toHaveBeenCalledTimes(3)
  act(() => shellZoom.set(1))
})

test("downloads are listed with progress, can be cancelled, and each ending is announced once", async () => {
  const { invoke } = await import("@tauri-apps/api/core")
  toast.success.mockClear()
  toast.error.mockClear()
  render(<BrowserWorkspace {...props} request={{ id: "a", url: "https://a.example/" }} />)
  await act(async () => {})
  expect(screen.queryByRole("button", { name: /^下载/ })).toBeNull()
  const report = (payload: Record<string, unknown>) =>
    act(() =>
      listeners.get("browser-download")!({
        payload: { label: "guest:x", url: "https://a.example/f/report.pdf", ...payload }
      })
    )
  report({ id: 1, path: "/Users/me/Downloads/report.pdf", received: 25, total: 100, state: "progress" })
  expect(toast.success).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "下载（1 个进行中）" }))
  expect(await screen.findByRole("progressbar", { name: "report.pdf 下载进度" })).toHaveAttribute("aria-valuenow", "25")
  fireEvent.click(screen.getByRole("button", { name: "取消" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_cancel_download", { label: "guest:x", id: 1 })
  report({ id: 1, path: "/Users/me/Downloads/report.pdf", received: 100, total: 100, state: "finished" })
  report({ id: 1, path: "/Users/me/Downloads/report.pdf", received: 100, total: 100, state: "finished" })
  expect(toast.success).toHaveBeenCalledTimes(1)
  expect(toast.success).toHaveBeenLastCalledWith("已下载：report.pdf", expect.anything())
  toast.success.mock.lastCall![1].action.onClick()
  expect(reveal).toHaveBeenCalledWith(["/Users/me/Downloads/report.pdf"])
  expect(screen.getByRole("button", { name: "下载（0 个进行中）" })).toBeInTheDocument()
  report({ id: 2, url: "https://a.example/f/big.zip", path: "", received: 10, total: 0, state: "progress" })
  expect(screen.getByText("已下载 0.0 MB")).toBeInTheDocument()
  report({ id: 2, url: "https://a.example/f/big.zip", path: "", received: 10, total: 0, state: "failed" })
  expect(toast.error).toHaveBeenLastCalledWith("下载失败：big.zip")
  // A cancellation is the user's own doing and is not announced.
  report({ id: 3, path: "/Users/me/Downloads/x.bin", received: 1, total: 9, state: "canceled" })
  expect(toast.error).toHaveBeenCalledTimes(1)
  // Ended downloads are kept for the next run, newest first, until the user clears the list.
  const { downloadStore, loadDownloads } = await import("../downloads")
  expect(downloadStore.getState().map((item) => [item.path, item.state])).toEqual([
    ["/Users/me/Downloads/x.bin", "canceled"],
    ["", "failed"],
    ["/Users/me/Downloads/report.pdf", "finished"]
  ])
  expect(loadDownloads()).toEqual(downloadStore.getState())
  fireEvent.click(screen.getByRole("button", { name: "清除下载记录" }))
  expect(loadDownloads()).toEqual([])
  expect(screen.queryByRole("button", { name: /^下载/ })).toBeNull()
})

test("a committed location is recorded once and its title follows", async () => {
  const { libraryStore } = await import("../library")
  libraryStore.setState({ history: [], bookmarks: [], search: "google" })
  render(<BrowserWorkspace {...props} request={{ id: "a", url: "https://a.example/" }} />)
  await act(async () => {})
  expect(libraryStore.getState().history.map(({ url, visits }) => ({ url, visits }))).toEqual([
    { url: "https://a.example/", visits: 1 }
  ])
  expect(JSON.parse(localStorage.getItem("alwith.browser.library.v1")!).history).toHaveLength(1)
})

test("a page's fullscreen takes the window fullscreen and gives it back as it was", async () => {
  nativeWindow.fullscreen = false
  nativeWindow.setFullscreen.mockClear()
  render(<BrowserWorkspace {...props} request={{ id: "a", url: "https://video.example/" }} />)
  await act(async () => {})
  expect(nativeWindow.setFullscreen).not.toHaveBeenCalled()
  await act(async () => metas.get("https://video.example/")!({ fullscreen: true }))
  expect(nativeWindow.setFullscreen).toHaveBeenLastCalledWith(true)
  await act(async () => metas.get("https://video.example/")!({ fullscreen: false }))
  expect(nativeWindow.setFullscreen).toHaveBeenLastCalledWith(false)
  // A window the user had already made fullscreen stays that way.
  nativeWindow.setFullscreen.mockClear()
  nativeWindow.fullscreen = true
  await act(async () => metas.get("https://video.example/")!({ fullscreen: true }))
  await act(async () => metas.get("https://video.example/")!({ fullscreen: false }))
  expect(nativeWindow.setFullscreen).not.toHaveBeenCalled()
})
