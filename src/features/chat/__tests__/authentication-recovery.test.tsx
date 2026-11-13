import { createSession } from "@alwith/module-chat/client"
import { drafts, importDraft } from "@alwith/module-chat/conversation"
import { render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { Composer } from "./timeline-host"

await initI18n("en")
const original = client.state
afterEach(() => {
  vi.restoreAllMocks()
  client.store.setState(original, true)
  drafts.clear()
})

test.each([true, false])("authentication errors do not offer login or model recovery: attached=%s", (attached) => {
  const session = {
    ...createSession("failed", "/tmp/project"),
    attached,
    error: { stopReason: "error", error: { code: -32000, message: "Authentication required" }, meta: null }
  }
  client.store.setState({
    connection: "ready",
    accountModelRecovery: { failed: true },
    agent: {
      protocolVersion: 2,
      info: { name: "Codex", version: "1" },
      capabilities: {},
      authMethods: [{ type: "agent", methodId: "chat-gpt", name: "ChatGPT" }]
    }
  })
  importDraft(session.id, { text: "Keep this unsent message", mentions: [], attachments: [], modelId: null })
  const login = vi.spyOn(client, "login")
  const resume = vi.spyOn(client, "resumeAccountModel")
  const prompt = vi.spyOn(client, "prompt")
  const view = render(<Composer session={session} />)
  try {
    expect(view.queryByRole("button", { name: "Sign in with ChatGPT" })).not.toBeInTheDocument()
    expect(view.queryByRole("button", { name: "Continue with selected model" })).not.toBeInTheDocument()
    expect(view.queryByText("Select a model to continue. History remains available.")).not.toBeInTheDocument()
    expect(drafts.get(session.id)?.text).toBe("Keep this unsent message")
    expect(login).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
  } finally {
    view.unmount()
  }
})
