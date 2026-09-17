import { addPrompt, applyUpdate, createSession, type Session } from "@alwith/api"
import { render } from "@testing-library/react"
import { afterEach, expect, test } from "bun:test"
import { ThemeProvider } from "@/components/theme-provider"
import { initI18n } from "@/lib/i18n"
import { groupTurns } from "../../turns"
import { AssistantTurn } from "../assistant-turn"
import { installDom } from "./dom-environment"

installDom()
await initI18n("en")
const mounted: Array<ReturnType<typeof render>> = []
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount()
})

function feed(session: Session, ...updates: unknown[]): Session {
  return updates.reduce<Session>((current, update) => applyUpdate(current, update as never), session)
}
const text = (messageId: string, content: string, phase: string) => ({
  sessionUpdate: "agent_message_chunk",
  messageId,
  content: { type: "text", text: content },
  _meta: { codex: { phase } }
})
function viewOf(session: Session, active = false, error: Session["error"] = null, isLast = true) {
  const turn = groupTurns(session)[0]
  return (
    <ThemeProvider>
      <AssistantTurn
        turn={turn}
        terminals={session.terminals}
        active={active}
        isLast={isLast}
        error={error}
        interrupted={false}
      />
    </ThemeProvider>
  )
}

test("U keeps commentary after the last tool inside work, using the shared Desktop turn layout", () => {
  const session = feed(
    addPrompt(createSession("phase-layout", "/tmp"), [{ type: "text", text: "go" }], "prompt"),
    { sessionUpdate: "tool_call_update", toolCallId: "read", name: "read_file", kind: "read", status: "completed" },
    text("comment", "Still checking the result", "commentary"),
    text("final", "Here is the final answer", "final_answer")
  )
  const view = render(viewOf(session))
  mounted.push(view)
  expect(view.container.querySelector(".codex-work-body")?.textContent).toContain("Still checking the result")
  expect(view.container.querySelector(".codex-final-answer")?.textContent).toContain("Here is the final answer")
  expect(view.container.querySelector(".codex-final-answer")?.textContent).not.toContain("Still checking the result")
  expect(view.getAllByRole("button", { name: "Copy" }).length).toBe(1)
})

test("streaming final-only responses stay outside work and expose actions only after completion", () => {
  const session = feed(
    addPrompt(createSession("final-only-layout", "/tmp"), [{ type: "text", text: "go" }], "prompt"),
    text("final", "Answer", "final_answer")
  )
  const view = render(viewOf(session, true))
  mounted.push(view)
  expect(view.container.querySelector(".codex-work-section")).toBeNull()
  expect(view.queryByRole("button", { name: "Copy" })).toBeNull()
  view.rerender(viewOf(session, false))
  expect(view.getByRole("button", { name: "Copy" })).toBeDefined()
})

test("compaction stays in work and a current-turn error is not repeated on earlier turns", () => {
  const session = feed(
    addPrompt(createSession("compaction-layout", "/tmp"), [{ type: "text", text: "go" }], "prompt"),
    { sessionUpdate: "compaction_update", compactionId: "compact", status: "completed" },
    text("final", "Preserved answer", "final_answer")
  )
  const error = {
    stopReason: "_error",
    meta: { codex: { error: { message: "Gateway unavailable", retryable: true } } }
  }
  const view = render(viewOf(session, false, error))
  mounted.push(view)
  expect(view.container.querySelector(".codex-work-body")?.textContent).toContain("Context compacted")
  expect(view.getByRole("alert").textContent).toContain("Gateway unavailable")
  view.rerender(viewOf(session, false, error, false))
  expect(view.queryByRole("alert")).toBeNull()
  expect(view.getByText("Preserved answer")).toBeDefined()
})
