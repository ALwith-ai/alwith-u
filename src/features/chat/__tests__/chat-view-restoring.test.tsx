import { applyUpdate, createSession } from "@nyssance/codex-acp-v2/client"
import { act, render } from "@testing-library/react"
import { expect, test, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { initI18n } from "@/lib/i18n"

import { navigationSoundStore } from "../codex/navigation-sound-store"

vi.mock("@tauri-apps/plugin-log", () => ({ info: async () => {} }))
const { ChatBody } = await import("./timeline-host")
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

test("retains an interrupted historical prompt without claiming its response was lost", async () => {
  const session = applyUpdate(
    { ...createSession("stopped-history", "/tmp/project"), attached: true },
    {
      sessionUpdate: "user_message",
      messageId: "stopped-prompt",
      content: [{ type: "text", text: "Stopped question" }],
      _meta: { codex: { turnId: "stopped-turn", historyInterrupted: true } }
    }
  )
  const view = render(
    <ThemeProvider>
      <ChatBody session={session} />
    </ThemeProvider>
  )
  expect(view.getByText("Stopped question")).toBeDefined()
  expect(view.queryByText("Stopped. Codex history may not contain the unfinished response.")).toBeNull()
  await act(async () => {})
})

test.each(["error", "cancelled"] as const)("shows %s before the first assistant token", async (reason) => {
  const { addPrompt } = await import("@nyssance/codex-acp-v2/client")
  const session = {
    ...addPrompt(
      createSession(`early-${reason}`, "/tmp/project"),
      [{ type: "text", text: "Awaiting reply" }],
      "prompt"
    ),
    state: "idle" as const,
    attached: true,
    lastStopReason: reason,
    error:
      reason === "error"
        ? { stopReason: "error", error: { code: -32603, message: "QA service unavailable" }, meta: null }
        : null
  }
  const view = render(
    <ThemeProvider>
      <ChatBody session={session} />
    </ThemeProvider>
  )
  expect(view.getByText(reason === "error" ? "QA service unavailable" : "Stopped")).toBeInTheDocument()
  expect(view.queryByText("Thinking")).toBeNull()
  view.unmount()
  await act(async () => {})
})

test("an accepted turn shows inline thinking while history restoration keeps its loader", async () => {
  const { addPrompt } = await import("@nyssance/codex-acp-v2/client")
  const initial = { ...createSession("thinking", "/tmp/project"), attached: true }
  const view = render(
    <ThemeProvider>
      <ChatBody session={{ ...initial, restoring: true }} />
    </ThemeProvider>
  )
  expect(view.container.querySelector(".animate-spin")).not.toBeNull()
  const running = {
    ...addPrompt(initial, [{ type: "text", text: "Think about it" }], "prompt"),
    state: "running" as const
  }
  view.rerender(
    <ThemeProvider>
      <ChatBody session={running} />
    </ThemeProvider>
  )
  expect(view.getByRole("status").textContent).toBe("Thinking")
  expect(view.container.querySelector(".codex-pending-message .codex-activity-running")).not.toBeNull()
  expect(view.container.querySelector(".animate-spin")).toBeNull()
  const time = view.container.querySelector(".codex-user-actions .codex-user-time")
  expect(time?.getAttribute("title")).toMatch(/\d{4}-\d{2}-\d{2}/)
  expect(time?.previousElementSibling?.getAttribute("aria-label")).toBe("Copy")
  view.unmount()
  await act(async () => {})
})

test("an interrupted prompt keeps its notice after another turn starts", async () => {
  let session = applyUpdate(
    { ...createSession("retained-stop", "/tmp/project"), attached: true },
    {
      sessionUpdate: "user_message",
      messageId: "stopped",
      content: [{ type: "text", text: "Interrupted prompt" }],
      _meta: { codex: { turnId: "turn-a", turnInterrupted: true } }
    }
  )
  session = applyUpdate(session, {
    sessionUpdate: "user_message",
    messageId: "next",
    content: [{ type: "text", text: "Next prompt" }]
  })
  const view = render(
    <ThemeProvider>
      <ChatBody session={{ ...session, state: "running" }} />
    </ThemeProvider>
  )
  expect(view.getAllByText("Stopped")).toHaveLength(1)
  expect(view.getByText("Thinking")).toBeInTheDocument()
  view.unmount()
  await act(async () => {})
})
