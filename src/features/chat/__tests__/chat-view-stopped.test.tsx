import { applyUpdate, createSession } from "@alwith/api"
import { act, fireEvent, render } from "@testing-library/react"
import { expect, test, vi } from "vitest"
import { ThemeProvider } from "@/components/theme-provider"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { ChatView } from "../chat-view"
import { navigationSoundStore } from "../codex/navigation-sound-store"

vi.mock("../chat-actions-menu", () => ({ ChatActionsMenu: () => null }))
vi.mock("../composer", () => ({ Composer: () => null }))
vi.mock("../dialogs/chat-search", () => ({ ChatSearch: () => null }))
vi.mock("../dialogs/diff-modal", () => ({ DiffModal: () => null }))
vi.mock("../dialogs/image-lightbox", () => ({ ImageLightbox: () => null, openImageLightbox: vi.fn() }))
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
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Reconnect" })))
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
