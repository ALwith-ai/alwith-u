import "./language"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"

import { BrowserPane, type BrowserPaneHandle } from "../browser-pane"

const { invoke, listeners } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>()
}))
// Extension buttons have their own suite; here they would only add calls to count.
vi.mock("../extension-actions", () => ({ ExtensionActions: () => null }))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(name, handler)
    return () => listeners.delete(name)
  }
}))
const props = { maximized: false, active: true, onMaximize: vi.fn(), onClose: vi.fn() }
const emit = (payload: Record<string, unknown>) =>
  act(() => listeners.get("browser-tab-updated")!({ payload: { label: "browser-test", ...payload } }))
async function mount(extra: Record<string, unknown> = {}) {
  invoke.mockImplementation(async (command: string) =>
    command === "cef_open_guest" ? { label: "browser-test", token: "opaque-token" } : undefined
  )
  const view = render(<BrowserPane {...props} {...extra} />)
  await waitFor(() => expect(listeners.has("browser-tab-updated")).toBe(true))
  await screen.findByTitle("实时网页")
  return view
}
beforeEach(() => {
  invoke.mockReset()
  listeners.clear()
})

test("history buttons follow the native session history", async () => {
  await mount()
  expect(screen.getByRole("button", { name: "后退" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "前进" })).toBeDisabled()
  emit({ loading: false, canGoBack: true, canGoForward: false })
  expect(screen.getByRole("button", { name: "后退" })).toBeEnabled()
  expect(screen.getByRole("button", { name: "前进" })).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "后退" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_history", { label: "browser-test", action: "back" })
})

test("loading shows native progress and turns reload into stop", async () => {
  await mount()
  expect(screen.queryByRole("progressbar")).toBeNull()
  emit({ loading: true, progress: 0 })
  emit({ progress: 0.42 })
  expect(screen.getByRole("progressbar", { name: "网页加载进度" })).toHaveAttribute("aria-valuenow", "42")
  expect(screen.queryByRole("button", { name: "刷新" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "停止加载" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_history", { label: "browser-test", action: "stop" })
  emit({ loading: false, progress: 1 })
  expect(screen.queryByRole("progressbar")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "刷新" }), { shiftKey: true })
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_history", { label: "browser-test", action: "hard-reload" })
})

test("a failed load offers a retry on the same guest and clears on the next navigation", async () => {
  await mount()
  emit({ error: { url: "https://down.example/", code: -105, description: "ERR_NAME_NOT_RESOLVED" } })
  expect(screen.getByRole("alert")).toHaveTextContent("ERR_NAME_NOT_RESOLVED (-105)")
  expect(screen.getByTitle("实时网页")).toHaveAttribute("data-content-id", "opaque-token")
  fireEvent.click(screen.getByRole("button", { name: "重试" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_history", { label: "browser-test", action: "reload" })
  expect(invoke).not.toHaveBeenCalledWith("cef_close_guest", expect.anything())
  emit({ loading: true, error: null })
  expect(screen.queryByRole("alert")).toBeNull()
})

test("a website whose certificate was refused is never called secure, however the user went on", async () => {
  await mount()
  const said = () => {
    fireEvent.click(screen.getByRole("button", { name: "网页信息" }))
    const text = document.body.textContent ?? ""
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    return text
  }
  emit({ url: "https://bank.example/" })
  expect(said()).toContain("连接是安全的")
  emit({ url: "http://plain.example/" })
  expect(said()).toContain("连接不安全")
  // The browser shows its own warning for the certificate: no failure panel covers it.
  emit({ url: "https://self-signed.example/", untrusted: "https://self-signed.example" })
  expect(screen.queryByRole("alert")).toBeNull()
  expect(said()).toContain("此网站的证书不受信任")
  // Having gone on regardless, the page is from the same website and is still not trusted.
  emit({ url: "https://self-signed.example/account", loading: false })
  expect(said()).toContain("此网站的证书不受信任")
  emit({ url: "https://bank.example/" })
  expect(said()).toContain("连接是安全的")
})

test("state reported before the tab subscribed is recovered from the snapshot", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "cef_open_guest"
      ? { label: "browser-test", token: "opaque-token" }
      : command === "cef_guest_metadata"
        ? { label: "browser-test", url: "https://early.example/", canGoBack: true, loading: true, progress: 0.3 }
        : undefined
  )
  render(<BrowserPane {...props} initialUrl="https://early.example/" />)
  await waitFor(() => expect(screen.getByRole("button", { name: "后退" })).toBeEnabled())
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "30")
})

test("an abandoned address edit restores the committed location", async () => {
  await mount()
  emit({ url: "https://kept.example/page" })
  const input = screen.getByRole("combobox", { name: "网页地址" })
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: "half typed" } })
  // Navigation under an edit must not overwrite what the user is typing.
  emit({ url: "https://kept.example/next" })
  expect(input).toHaveValue("half typed")
  fireEvent.keyDown(input, { key: "Escape" })
  expect(input).toHaveValue("https://kept.example/next")
})

test("pane commands drive the same native actions as the toolbar", async () => {
  let handle: BrowserPaneHandle | null = null
  await mount({ ref: (value: BrowserPaneHandle | null) => (handle = value), initialUrl: "https://a.example/" })
  act(() => handle!.run("hard-reload"))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_history", { label: "browser-test", action: "hard-reload" })
  act(() => handle!.run("focus-address"))
  expect(screen.getByRole("combobox", { name: "网页地址" })).toHaveFocus()
})

test("a blank tab starts in the address bar and a page tab does not", async () => {
  const view = await mount()
  expect(screen.getByRole("combobox", { name: "网页地址" })).toHaveFocus()
  view.unmount()
  listeners.clear()
  await mount({ initialUrl: "https://a.example/" })
  expect(screen.getByRole("combobox", { name: "网页地址" })).not.toHaveFocus()
})

test("find searches as the user types, steps through matches and clears on close", async () => {
  let handle: BrowserPaneHandle | null = null
  await mount({ ref: (value: BrowserPaneHandle | null) => (handle = value), initialUrl: "https://a.example/" })
  expect(screen.queryByRole("search")).toBeNull()
  act(() => handle!.run("find"))
  const input = await screen.findByRole("textbox", { name: "查找内容" })
  await waitFor(() => expect(input).toHaveFocus())
  expect(screen.getByRole("button", { name: "下一个匹配项" })).toBeDisabled()
  fireEvent.change(input, { target: { value: "needle" } })
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_find", {
    label: "browser-test",
    text: "needle",
    forward: true,
    next: false
  })
  // A new search reports its matches without highlighting one: step onto the first, once.
  emit({ find: { count: 3, active: 0, final: true } })
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_find", {
    label: "browser-test",
    text: "needle",
    forward: true,
    next: true
  })
  const steps = () => invoke.mock.calls.filter(([command, args]) => command === "cef_guest_find" && args.next).length
  expect(steps()).toBe(1)
  // The count and the highlighted match arrive in separate native updates.
  emit({ find: { count: 3, active: null, final: false } })
  emit({ find: { count: null, active: 1, final: true } })
  expect(screen.getByText("1/3")).toBeInTheDocument()
  expect(steps()).toBe(1)
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true })
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_find", {
    label: "browser-test",
    text: "needle",
    forward: false,
    next: true
  })
  act(() => handle!.run("find-next"))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_find", {
    label: "browser-test",
    text: "needle",
    forward: true,
    next: true
  })
  fireEvent.keyDown(input, { key: "Escape" })
  expect(screen.queryByRole("search")).toBeNull()
  // An empty search clears the page's highlights.
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_find", {
    label: "browser-test",
    text: "",
    forward: true,
    next: false
  })
})

test("a website's permission request waits for the user's own answer", async () => {
  await mount({ initialUrl: "https://maps.example/" })
  expect(screen.queryByRole("group", { name: "网站权限请求" })).toBeNull()
  emit({ permission: { id: 7, origin: "https://maps.example", kinds: ["Geolocation", "Notifications", "Mystery"] } })
  expect(screen.getByRole("group", { name: "网站权限请求" })).toHaveTextContent(
    "https://maps.example 想要使用：位置信息、通知、其他权限"
  )
  expect(invoke).not.toHaveBeenCalledWith("cef_guest_permission", expect.anything())
  fireEvent.click(screen.getByRole("button", { name: "拒绝" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_permission", { label: "browser-test", id: 7, allow: false })
  emit({ permission: null })
  expect(screen.queryByRole("group", { name: "网站权限请求" })).toBeNull()
  emit({ permission: { id: 8, origin: "https://maps.example", kinds: ["Camera"] } })
  fireEvent.click(screen.getByRole("button", { name: "允许" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_permission", { label: "browser-test", id: 8, allow: true })
})

test("a screen share is offered as a window or a screen, never as a plain allow", async () => {
  await mount({ initialUrl: "https://meet.example/" })
  emit({ permission: { id: 9, origin: "https://meet.example", kinds: ["DisplayCapture"] } })
  expect(screen.queryByRole("button", { name: "允许" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "共享窗口" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_permission", {
    label: "browser-test",
    id: 9,
    allow: true,
    window: true
  })
  emit({ permission: { id: 10, origin: "https://meet.example", kinds: ["DisplayCapture"] } })
  fireEvent.click(screen.getByRole("button", { name: "共享屏幕" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_permission", { label: "browser-test", id: 10, allow: true })
})

test("a sign-in is kept only on the user's word, and the question never holds the password", async () => {
  await mount({ initialUrl: "https://shop.example/login" })
  expect(screen.queryByRole("group", { name: "登录信息保存提示" })).toBeNull()
  emit({ login: { id: 3, origin: "https://shop.example", username: "ada@example.com", update: false } })
  const question = screen.getByRole("group", { name: "登录信息保存提示" })
  expect(question).toHaveTextContent("要保存这个登录信息吗？ ada@example.com · https://shop.example")
  expect(invoke).not.toHaveBeenCalledWith("cef_guest_login_answer", expect.anything())
  fireEvent.click(screen.getByRole("button", { name: "保存" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_login_answer", { label: "browser-test", id: 3, action: "save" })
  emit({ login: null })
  expect(screen.queryByRole("group", { name: "登录信息保存提示" })).toBeNull()
  // A changed password asks to update; the user may also say never for this website.
  emit({ login: { id: 4, origin: "https://shop.example", username: "", update: true } })
  expect(screen.getByRole("group", { name: "登录信息保存提示" })).toHaveTextContent(
    "要更新已保存的密码吗？ （无用户名） · https://shop.example"
  )
  expect(screen.getByRole("button", { name: "更新" })).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "此网站一律不保存" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_login_answer", { label: "browser-test", id: 4, action: "never" })
})

test("typing offers known pages, arrows choose one, and a search uses the chosen provider", async () => {
  const { libraryStore, setSearchProvider } = await import("../library")
  libraryStore.setState({
    history: [
      { url: "https://example.com/docs", title: "Docs", visits: 3, last: Date.now() },
      { url: "https://other.example/", title: "Other", visits: 1, last: Date.now() }
    ],
    bookmarks: [{ url: "https://example.com/", title: "Example" }],
    search: "google"
  })
  await mount({ initialUrl: "https://start.example/" })
  const input = screen.getByRole("combobox", { name: "网页地址" })
  expect(screen.queryByRole("listbox")).toBeNull()
  fireEvent.focus(input)
  // Nothing new was typed yet.
  expect(screen.queryByRole("listbox")).toBeNull()
  fireEvent.change(input, { target: { value: "exam" } })
  const options = screen.getAllByRole("option")
  expect(options.map((option) => option.textContent)).toEqual([
    // A page visited often outranks one that is only bookmarked.
    "Docshttps://example.com/docs",
    "Examplehttps://example.com/",
    "Otherhttps://other.example/"
  ])
  expect(input).toHaveAttribute("aria-expanded", "true")
  fireEvent.keyDown(input, { key: "ArrowDown" })
  fireEvent.keyDown(input, { key: "ArrowDown" })
  expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true")
  fireEvent.submit(input.closest("form")!)
  expect(invoke).toHaveBeenLastCalledWith("cef_navigate_guest", {
    label: "browser-test",
    url: "https://example.com/"
  })
  expect(screen.queryByRole("listbox")).toBeNull()
  // Past the last suggestion is the typed text itself: a search with the chosen provider.
  // The first navigation has been accepted.
  await act(async () => {})
  act(() => setSearchProvider("duckduckgo"))
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: "exam results" } })
  fireEvent.submit(input.closest("form")!)
  expect(invoke).toHaveBeenLastCalledWith("cef_navigate_guest", {
    label: "browser-test",
    url: "https://duckduckgo.com/?q=exam%20results"
  })
  libraryStore.setState({ history: [], bookmarks: [], search: "google" })
})

test("a page that is open in another tab is offered as that tab, and choosing it loads nothing here", async () => {
  const onSwitchTab = vi.fn()
  await mount({
    initialUrl: "https://start.example/",
    openPages: [{ url: "https://open.example/inbox", title: "Inbox" }],
    onSwitchTab
  })
  const input = screen.getByRole("combobox", { name: "网页地址" })
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: "open" } })
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Inboxhttps://open.example/inbox切换到此标签页"
  ])
  fireEvent.keyDown(input, { key: "ArrowDown" })
  fireEvent.submit(input.closest("form")!)
  expect(onSwitchTab).toHaveBeenCalledWith("https://open.example/inbox")
  expect(invoke).not.toHaveBeenCalledWith("cef_navigate_guest", expect.anything())
  // The address goes back to the page this tab shows.
  expect(input).toHaveValue("https://start.example/")
  expect(screen.queryByRole("listbox")).toBeNull()
})

test("a page is bookmarked from the toolbar and a blank tab offers the user's own pages", async () => {
  const { libraryStore } = await import("../library")
  libraryStore.setState({ history: [], bookmarks: [], search: "google" })
  await mount()
  // A blank tab cannot be bookmarked and starts on the start page.
  expect(screen.getByRole("button", { name: "添加书签" })).toBeDisabled()
  expect(screen.getByRole("navigation", { name: "起始页" })).toHaveTextContent("输入网址或搜索内容开始浏览。")
  emit({ url: "https://news.example/today" })
  emit({ title: "Today's news" })
  expect(screen.queryByRole("navigation", { name: "起始页" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "添加书签" }))
  expect(libraryStore.getState().bookmarks).toEqual([{ url: "https://news.example/today", title: "Today's news" }])
  expect(screen.getByRole("button", { name: "移除书签" })).toHaveAttribute("aria-pressed", "true")
  emit({ url: "about:blank" })
  fireEvent.click(screen.getByRole("button", { name: "Today's news" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_navigate_guest", {
    label: "browser-test",
    url: "https://news.example/today"
  })
  emit({ url: "https://news.example/today" })
  fireEvent.click(screen.getByRole("button", { name: "移除书签" }))
  expect(libraryStore.getState().bookmarks).toEqual([])
})

test("a page's dialog is shown in its tab and answered there", async () => {
  await mount({ initialUrl: "https://shop.example/" })
  expect(screen.queryByRole("alertdialog")).toBeNull()
  emit({ dialog: { id: 1, kind: "alert", origin: "https://shop.example/cart", message: "Saved", defaultText: "" } })
  const alert = screen.getByRole("alertdialog", { name: "网页对话框" })
  expect(alert).toHaveTextContent("shop.example 显示：Saved")
  // An alert has nothing to refuse.
  expect(screen.queryByRole("button", { name: "取消" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "确定" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_dialog", {
    label: "browser-test",
    id: 1,
    accept: true,
    text: null
  })
  emit({ dialog: null })
  expect(screen.queryByRole("alertdialog")).toBeNull()

  emit({ dialog: { id: 2, kind: "prompt", origin: "https://shop.example/", message: "Name?", defaultText: "guest" } })
  const input = screen.getByRole("textbox", { name: "对话框输入" })
  expect(input).toHaveValue("guest")
  fireEvent.change(input, { target: { value: "Ada" } })
  fireEvent.submit(screen.getByRole("alertdialog"))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_dialog", {
    label: "browser-test",
    id: 2,
    accept: true,
    text: "Ada"
  })

  emit({ dialog: { id: 3, kind: "confirm", origin: "", message: "Delete?", defaultText: "" } })
  expect(screen.getByRole("alertdialog")).toHaveTextContent("此网页 显示：Delete?")
  fireEvent.click(screen.getByRole("button", { name: "取消" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_dialog", {
    label: "browser-test",
    id: 3,
    accept: false,
    text: null
  })

  // Leaving a page uses the browser's own wording, never the page's.
  emit({
    dialog: { id: 4, kind: "beforeunload", origin: "https://shop.example/", message: "ignored", defaultText: "" }
  })
  expect(screen.getByRole("alertdialog")).toHaveTextContent("要离开此网页吗？")
  expect(screen.getByRole("alertdialog")).not.toHaveTextContent("ignored")
  fireEvent.click(screen.getByRole("button", { name: "留下" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_dialog", {
    label: "browser-test",
    id: 4,
    accept: false,
    text: null
  })
})

test("a server's login challenge is answered in the tab, and cancelling sends no credentials", async () => {
  await mount({ initialUrl: "https://intranet.example/" })
  expect(screen.queryByRole("form", { name: "网站登录" })).toBeNull()
  emit({ auth: { id: 5, host: "intranet.example", port: 443, realm: "Staff", isProxy: false } })
  expect(screen.getByRole("form", { name: "网站登录" })).toHaveTextContent("intranet.example:443 要求登录（Staff）")
  fireEvent.change(screen.getByRole("textbox", { name: "用户名" }), { target: { value: "ada" } })
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "s3cret" } })
  fireEvent.submit(screen.getByRole("form", { name: "网站登录" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_auth", {
    label: "browser-test",
    id: 5,
    username: "ada",
    password: "s3cret"
  })
  // A wrong password is asked for again, starting empty.
  emit({ auth: { id: 6, host: "intranet.example", port: 443, realm: "Staff", isProxy: false } })
  expect(screen.getByLabelText("密码")).toHaveValue("")
  fireEvent.click(screen.getByRole("button", { name: "取消" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_guest_auth", {
    label: "browser-test",
    id: 6,
    username: null,
    password: null
  })
  emit({ auth: null })
  expect(screen.queryByRole("form", { name: "网站登录" })).toBeNull()
})

test("a page in fullscreen fills the window and returns to its place afterwards", async () => {
  const onMeta = vi.fn()
  await mount({ initialUrl: "https://video.example/", onMeta })
  const surface = screen.getByTitle("实时网页")
  expect(surface).not.toHaveClass("fixed")
  emit({ fullscreen: true })
  expect(surface).toHaveClass("fixed", "inset-0")
  expect(onMeta).toHaveBeenLastCalledWith({ fullscreen: true })
  // The same guest, not a second one.
  expect(screen.getByTitle("实时网页")).toBe(surface)
  emit({ fullscreen: false })
  expect(surface).not.toHaveClass("fixed")
  expect(onMeta).toHaveBeenLastCalledWith({ fullscreen: false })
})

test("the menu opens the installed extensions and the store, and the address bar shows the extensions page", async () => {
  await mount()
  fireEvent.click(screen.getByRole("button", { name: "浏览器菜单" }))
  fireEvent.click(await screen.findByRole("menuitem", { name: "管理扩展" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_navigate_guest", { label: "browser-test", url: "chrome://extensions/" })
  emit({ url: "chrome://extensions/?id=abc" })
  expect(screen.getByLabelText("网页地址")).toHaveValue("chrome://extensions/?id=abc")
  // No other internal page is ever shown as a location.
  emit({ url: "chrome://settings/" })
  expect(screen.getByLabelText("网页地址")).toHaveValue("chrome://extensions/?id=abc")
  fireEvent.click(screen.getByRole("button", { name: "浏览器菜单" }))
  fireEvent.click(await screen.findByRole("menuitem", { name: "获取扩展" }))
  expect(invoke).toHaveBeenLastCalledWith("cef_navigate_guest", {
    label: "browser-test",
    url: "https://chromewebstore.google.com/category/extensions"
  })
})
