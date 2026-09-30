import { expect, mock, test } from "bun:test"
import { applyUpdate, createSession } from "@alwith/api"
import { act, render } from "@testing-library/react"
import { ThemeProvider } from "@/components/theme-provider"
import { initI18n } from "@/lib/i18n"
import { installDom } from "../codex/__tests__/dom-environment"
import { navigationSoundStore } from "../codex/navigation-sound-store"

installDom()
mock.module("@tauri-apps/plugin-log", () => ({ info: async () => {} }))
const { ChatBody } = await import("../chat-body")
await initI18n("en")
navigationSoundStore.setState({ soundMode: "none" })

test("shows restored messages before session/resume finishes", async () => {
  const initial = createSession("history-1", "/tmp/project")
  const restoring = applyUpdate(
    { ...initial, restoring: true, attached: false },
    {
      sessionUpdate: "user_message",
      messageId: "message-1",
      content: [{ type: "text", text: "Earlier question" }]
    }
  )

  const view = render(
    <ThemeProvider>
      <ChatBody session={restoring} />
    </ThemeProvider>
  )

  expect(view.getByText("Earlier question")).toBeDefined()
  expect(view.queryByText("Open this chat")).toBeNull()
  // Pane queues its initial measurement; flush it before this file releases its DOM.
  await act(async () => {})
})
