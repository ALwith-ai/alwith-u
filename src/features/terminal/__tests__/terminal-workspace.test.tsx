import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"

import { DeviceWorkspaceMenu } from "@/features/device/device-workspace"
import { WorkspaceContext } from "@/features/workspace/context"

import { TerminalWorkspaceMenuItem, TerminalWorkspacePane } from "../terminal-workspace"

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  openPane: vi.fn(),
  list: vi.fn(),
  snapshot: vi.fn(),
  activate: vi.fn(),
  close: vi.fn(),
  remember: vi.fn()
}))
vi.mock("@alwith/module-terminal/tauri", () => ({
  terminalClient: {
    capabilities: mocks.capabilities,
    list: mocks.list,
    snapshot: mocks.snapshot,
    activate: mocks.activate,
    close: mocks.close
  }
}))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }))
vi.mock("@/components/theme-provider", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }))
vi.mock("../view-preferences", () => ({
  rememberTerminalViews: mocks.remember,
  restoreTerminalViews: () => Promise.resolve(null)
}))
vi.mock("@alwith/module-terminal/react", () => ({
  TerminalView: ({ snapshot }: { snapshot: { terminalId: string } }) => (
    <div data-testid="terminal-view">{snapshot.terminalId}</div>
  )
}))
beforeEach(() => vi.clearAllMocks())
function mount() {
  const view = render(
    <WorkspaceContext.Provider
      value={{
        visible: false,
        toggle: vi.fn(),
        openFile: vi.fn(),
        openProject: vi.fn(),
        revealEntry: vi.fn(),
        openPane: mocks.openPane
      }}
    >
      <DeviceWorkspaceMenu>
        <TerminalWorkspaceMenuItem />
      </DeviceWorkspaceMenu>
    </WorkspaceContext.Provider>
  )
  fireEvent.click(view.getByRole("button", { name: "actions.more" }))
  return view
}
test("production native capability hides the terminal entry even with development frontend", async () => {
  mocks.capabilities.mockResolvedValue({ interactiveView: false, headless: true })
  mount()
  await waitFor(() => expect(mocks.capabilities).toHaveBeenCalledOnce())
  expect(screen.queryByRole("menuitem", { name: "terminal.open" })).not.toBeInTheDocument()
})
test("embedded development native capability exposes the terminal entry", async () => {
  mocks.capabilities.mockResolvedValue({ interactiveView: true, headless: true })
  mount()
  expect(screen.getByRole("menuitem", { name: "device.panel.open" })).toBeInTheDocument()
  const button = await screen.findByRole("menuitem", { name: "terminal.open" })
  button.click()
  expect(mocks.openPane).toHaveBeenCalledWith("terminal")
})

test("terminal uses workspace tabs with per-tab close and no permanent control or hint rows", async () => {
  let entries = [
    { terminalId: "one", title: "zsh", cwd: "/work", interactive: true, ownerWindow: "main", viewOwnerWindow: null },
    { terminalId: "two", title: "server", cwd: "/work", interactive: true, ownerWindow: "main", viewOwnerWindow: null }
  ]
  let active = "one"
  mocks.capabilities.mockResolvedValue({ interactiveView: true, headless: true })
  mocks.list.mockImplementation(() => Promise.resolve(entries))
  mocks.snapshot.mockImplementation(() => Promise.resolve(entries.find((entry) => entry.terminalId === active) ?? null))
  mocks.activate.mockImplementation((_session: string, id: string) => {
    active = id
    return Promise.resolve()
  })
  mocks.close.mockImplementation((entry: { terminalId: string }) => {
    entries = entries.filter((item) => item.terminalId !== entry.terminalId)
    return Promise.resolve()
  })
  const { container } = render(<TerminalWorkspacePane sessionId="chat-one" cwd="/work" onClose={vi.fn()} />)
  const tab = await screen.findByRole("tab", { name: "server" })
  expect(tab.closest(".alwith-workspace-tabbar")).not.toBeNull()
  expect(screen.queryByRole("button", { name: "terminal.restart" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "terminal.stop" })).not.toBeInTheDocument()
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  expect(screen.queryByText("/work")).not.toBeInTheDocument()
  fireEvent.click(tab)
  await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith("chat-one", "two"))
  expect(await screen.findByRole("tabpanel")).toHaveAttribute("id", "terminal-panel-two")
  fireEvent.click(screen.getByRole("button", { name: "terminal.close server" }))
  await waitFor(() => expect(screen.queryByRole("tab", { name: "server" })).not.toBeInTheDocument())
  expect(mocks.close).toHaveBeenCalledWith(expect.objectContaining({ terminalId: "two" }))
  expect(screen.getByRole("tab", { name: "zsh" })).toHaveAttribute("aria-selected", "true")
  fireEvent.keyDown(container.querySelector("[data-terminal-workspace]")!, { key: "f", metaKey: true })
  expect(screen.getByRole("textbox", { name: "terminal.search" })).toHaveFocus()
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" })
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
})

test("a poll started before close cannot restore a deleted terminal tab", async () => {
  const entry = {
    terminalId: "closing",
    title: "zsh",
    cwd: "/work",
    interactive: true,
    ownerWindow: "main",
    viewOwnerWindow: null
  }
  let entries = [entry]
  mocks.capabilities.mockResolvedValue({ interactiveView: true, headless: true })
  mocks.list.mockImplementation(() => Promise.resolve(entries))
  mocks.snapshot.mockImplementation(() => Promise.resolve(entries[0] ?? null))
  mocks.close.mockImplementation(() => {
    entries = []
    return Promise.resolve()
  })
  vi.useFakeTimers()
  const { unmount } = render(<TerminalWorkspacePane sessionId="chat-close" cwd="/work" onClose={vi.fn()} />)
  await act(() => Promise.resolve())
  expect(screen.getByRole("tab", { name: "zsh" })).toBeInTheDocument()
  let finish!: (entries: (typeof entry)[]) => void
  const pending = new Promise<(typeof entry)[]>((resolve) => {
    finish = resolve
  })
  mocks.list.mockImplementationOnce(() => pending)
  try {
    const readsBeforePoll = mocks.list.mock.calls.length
    await act(() => {
      vi.advanceTimersByTime(500)
      return Promise.resolve()
    })
    expect(mocks.list).toHaveBeenCalledTimes(readsBeforePoll + 1)
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "terminal.close zsh" }))
      return Promise.resolve()
    })
    expect(screen.queryByRole("tab", { name: "zsh" })).not.toBeInTheDocument()
    await act(async () => {
      finish([entry])
      await pending
    })
    expect(screen.queryByRole("tab", { name: "zsh" })).not.toBeInTheDocument()
    expect(screen.queryByTestId("terminal-view")).not.toBeInTheDocument()
    expect(mocks.close).toHaveBeenCalledOnce()
  } finally {
    unmount()
    vi.useRealTimers()
  }
})
