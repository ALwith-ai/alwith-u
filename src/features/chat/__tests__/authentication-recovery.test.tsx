import { createSession } from "@alwith/module-chat/client"
import { drafts, importDraft } from "@alwith/module-chat/conversation"
import { act, fireEvent, render } from "@testing-library/react"
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

test("an attached turn error keeps its composer instead of starting replay recovery", () => {
  const session = {
    ...createSession("attached", "/tmp/project"),
    attached: true,
    error: { stopReason: "error", error: { code: -32000, message: "Authentication required" }, meta: null }
  }
  client.store.setState({
    connection: "ready",
    agent: {
      protocolVersion: 2,
      info: { name: "Codex", version: "1" },
      capabilities: {},
      authMethods: [{ type: "agent", methodId: "chat-gpt", name: "ChatGPT" }]
    }
  })
  const view = render(<Composer session={session} />)
  try {
    expect(view.getByRole("textbox")).toBeInTheDocument()
    expect(view.queryByRole("button", { name: "Sign in with ChatGPT" })).not.toBeInTheDocument()
  } finally {
    view.unmount()
  }
})

test.each([true, false])(
  "login recovery reopens only its conversation after successful login: %s",
  async (succeeds) => {
    const session = {
      ...createSession("expired", "/tmp/original"),
      error: { stopReason: "error", error: { code: -32000, message: "Authentication required" }, meta: null }
    }
    client.store.setState({
      connection: "ready",
      agent: {
        protocolVersion: 2,
        info: { name: "Codex", version: "1" },
        capabilities: {},
        authMethods: [{ type: "agent", methodId: "chat-gpt", name: "ChatGPT" }]
      }
    })
    importDraft(session.id, { text: "Keep this unsent message", mentions: [], attachments: [], modelId: null })
    const login = vi.spyOn(client, "login").mockImplementation(async () => {
      if (!succeeds) throw new Error("Login cancelled")
    })
    const open = vi.spyOn(client, "open").mockResolvedValue()
    const prompt = vi.spyOn(client, "prompt")
    const view = render(<Composer session={{ ...session, attached: true, error: null }} />)
    try {
      expect(view.getByRole("textbox")).toHaveValue("Keep this unsent message")
      view.rerender(<Composer session={session} />)
      const button = view.getByRole("button", { name: "Sign in with ChatGPT" })
      expect(view.queryByRole("textbox")).not.toBeInTheDocument()
      await act(async () => fireEvent.click(button))
      expect(login).toHaveBeenCalledWith("chat-gpt", {})
      if (succeeds) expect(open).toHaveBeenCalledExactlyOnceWith("expired", "/tmp/original")
      else expect(open).not.toHaveBeenCalled()
      expect(button).toBeEnabled()
      expect(drafts.get(session.id)?.text).toBe("Keep this unsent message")
      expect(prompt).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  }
)
