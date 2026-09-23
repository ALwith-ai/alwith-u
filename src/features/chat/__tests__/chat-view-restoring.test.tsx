import { applyUpdate, createSession } from "@alwith/api"
import { render } from "@testing-library/react"
import { expect, mock, test } from "bun:test"
import { ThemeProvider } from "@/components/theme-provider"
import { initI18n } from "@/lib/i18n"
import { navigationSoundStore } from "../codex/navigation-sound-store"
import { installDom } from "../codex/__tests__/dom-environment"

installDom()
mock.module("@tauri-apps/plugin-log", () => ({ info: async () => {} }))
const { ChatBody } = await import("../chat-body")
await initI18n("en")
navigationSoundStore.setState({ soundMode: "none" })

test("shows restored messages before session/resume finishes", () => {
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
})
