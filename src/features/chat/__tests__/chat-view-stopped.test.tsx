import { applyUpdate, createSession } from "@alwith/api"
import { act, fireEvent, render } from "@testing-library/react"
import { expect, test, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { ChatView } from "../chat-view"
import { navigationSoundStore } from "../codex/navigation-sound-store"

vi.mock("../chat-actions-menu", () => ({ ChatActionsMenu: () => null }))
vi.mock("../composer", () => ({ ChatComposer: () => null }))
vi.mock("../dialogs/chat-search", () => ({ ChatSearch: () => null }))
vi.mock("../dialogs/image-lightbox", () => ({
  ImageLightbox: () => null,
  openImageLightbox: vi.fn(),
  openImageGallery: vi.fn()
}))
vi.mock("@tauri-apps/plugin-log", () => ({ info: async () => {} }))

await initI18n("en")
navigationSoundStore.setState({ soundMode: "none" })

test("a stopped chat keeps its transcript and reconnects that session", async () => {
  const original = client.state
  const open = vi.spyOn(client, "open").mockResolvedValue()
  const session = applyUpdate(createSession("stopped", "/tmp/stopped"), {
    sessionUpdate: "user_message",
    messageId: "question",
    content: [{ type: "text", text: "Retained question" }]
  })
  client.store.setState({ connection: "ready" })
  const view = render(
    <ThemeProvider>
      <ChatView session={{ ...session, attached: false }} onNewChat={() => {}} onDeleted={() => {}} />
    </ThemeProvider>
  )
  try {
    expect(view.getByText("Retained question")).toBeInTheDocument()
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Reconnect" }))))
    expect(open).toHaveBeenCalledExactlyOnceWith("stopped", "/tmp/stopped")
    view.rerender(
      <ThemeProvider>
        <ChatView session={{ ...session, attached: true }} onNewChat={() => {}} onDeleted={() => {}} />
      </ThemeProvider>
    )
    expect(view.queryByRole("button", { name: "Reconnect" })).not.toBeInTheDocument()
    expect(view.getByText("Retained question")).toBeInTheDocument()
  } finally {
    view.unmount()
    open.mockRestore()
    client.store.setState(original, true)
  }
})

test("a read-only chat retries its own session and disables retry while restoring", async () => {
  const original = client.state
  const open = vi.spyOn(client, "open").mockResolvedValue()
  const session = { ...createSession("locked", "/tmp/locked"), attached: false, readOnly: true }
  client.store.setState({ connection: "ready" })
  const renderChat = (restoring: boolean, readOnly = true) => (
    <ThemeProvider>
      <ChatView session={{ ...session, restoring, readOnly }} onNewChat={() => {}} onDeleted={() => {}} />
    </ThemeProvider>
  )
  const view = render(renderChat(false))
  try {
    expect(view.queryByRole("button", { name: "Reconnect" })).not.toBeInTheDocument()
    const notice = view.container.querySelector("[data-readonly-composer]")
    expect(notice).not.toBeNull()
    expect(view.container.querySelector("[data-chat-content]")?.lastElementChild).toBe(notice)
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Retry" }))))
    expect(open).toHaveBeenCalledExactlyOnceWith("locked", "/tmp/locked")
    view.rerender(renderChat(true))
    const retry = view.getByRole("button", { name: "Restoring conversation" })
    expect(retry).toBeDisabled()
    fireEvent.click(retry)
    expect(open).toHaveBeenCalledTimes(1)
    view.rerender(renderChat(false))
    expect(view.getByRole("button", { name: "Retry" })).toBeEnabled()
    view.rerender(renderChat(false, false))
    expect(view.queryByText("Open in another app")).not.toBeInTheDocument()
  } finally {
    view.unmount()
    open.mockRestore()
    client.store.setState(original, true)
  }
})

test("the locked footer uses Codex copy and keeps enabled actions beside the message", async () => {
  const original = client.state
  const open = vi.spyOn(client, "open").mockResolvedValue()
  const fork = vi.spyOn(client, "fork").mockResolvedValue("child")
  const select = vi.fn()
  const session = applyUpdate(
    { ...createSession("locked-footer", "/tmp/locked"), readOnly: true },
    {
      sessionUpdate: "user_message",
      messageId: "opening",
      content: [{ type: "text", text: "History" }],
      _meta: { codex: { turnId: "native-boundary" } }
    }
  )
  client.store.setState({
    connection: "ready",
    agent: {
      info: { name: "test", version: "1" },
      protocolVersion: 2,
      capabilities: { session: { fork: {} }, _meta: { codex: { forkAtTurn: true } } }
    },
    sessionList: [{ sessionId: "child", cwd: "/tmp/locked", title: "Branch", archived: false, updatedAt: null }]
  })
  await initI18n("zh-CN")
  const view = render(
    <ThemeProvider>
      <ChatView session={session} onSelectSession={select} onNewChat={() => {}} onDeleted={() => {}} />
    </ThemeProvider>
  )
  try {
    expect(view.getByText("已在另一个应用中打开")).toBeInTheDocument()
    const description = view.getByText("请先在那边关闭会话，才能在这里继续。")
    const retry = view.getByRole("button", { name: "重试" })
    const branch = view.getByRole("button", { name: "创建聊天分叉" })
    expect(retry).toBeEnabled()
    expect(branch).toBeEnabled()
    const actions = view.container.querySelector("[data-readonly-actions]")
    expect(actions?.contains(retry)).toBe(true)
    expect(actions?.contains(branch)).toBe(true)
    expect(description.parentElement?.contains(actions)).toBe(false)
    expect(retry).toHaveClass("text-foreground")
    expect(branch).toHaveClass("text-foreground")
    await act(() => Promise.try(() => fireEvent.click(retry)))
    expect(open).toHaveBeenCalledExactlyOnceWith("locked-footer", "/tmp/locked")
    await act(() => Promise.try(() => fireEvent.click(branch)))
    expect(fork).toHaveBeenCalledExactlyOnceWith("locked-footer", "/tmp/locked", "native-boundary")
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "child" }))
  } finally {
    view.unmount()
    open.mockRestore()
    fork.mockRestore()
    client.store.setState(original, true)
    await initI18n("en")
  }
})
