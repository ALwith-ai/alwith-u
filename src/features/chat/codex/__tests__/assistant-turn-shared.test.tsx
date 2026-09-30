import { afterEach, expect, test } from "bun:test"
import { addPrompt, applyUpdate, createSession, type Session } from "@alwith/api"
import { render } from "@testing-library/react"
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

test("final answer keeps text and image blocks in their original order", () => {
  const session = feed(addPrompt(createSession("mixed-answer", "/tmp"), [{ type: "text", text: "go" }], "prompt"), {
    sessionUpdate: "agent_message",
    messageId: "final",
    content: [
      { type: "text", text: "Before" },
      { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
      { type: "text", text: "After" }
    ],
    _meta: { codex: { phase: "final_answer" } }
  })
  const view = render(viewOf(session))
  mounted.push(view)
  const answer =
    view.container.querySelector(".codex-final-answer") ?? view.container.querySelector(".codex-assistant-turn")
  expect(answer?.querySelectorAll(".codex-assistant-message, img").length).toBe(3)
  expect(
    Array.from(
      answer?.querySelectorAll(".codex-assistant-message, img") ?? [],
      element => element.textContent || element.tagName
    )
  ).toEqual(["Before", "IMG", "After"])
  expect(answer?.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=")
  expect(view.getByRole("button", { name: "View image" })).toBeDefined()
})

test("an image-only final answer is visible", () => {
  const session = feed(addPrompt(createSession("image-answer", "/tmp"), [{ type: "text", text: "go" }], "prompt"), {
    sessionUpdate: "agent_message",
    messageId: "final",
    content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
    _meta: { codex: { phase: "final_answer" } }
  })
  const view = render(viewOf(session))
  mounted.push(view)
  expect(view.container.querySelector(".codex-assistant-turn img")?.getAttribute("src")).toBe(
    "data:image/png;base64,aGVsbG8="
  )
})

test("completed replies show the original batch time in the shared action bar", () => {
  const session = feed(
    { ...createSession("original-time", "/tmp"), restoring: true },
    {
      sessionUpdate: "agent_message",
      messageId: "final",
      content: [{ type: "text", text: "Answer" }],
      _meta: { codex: { phase: "final_answer", turnStartedAt: new Date(2024, 0, 2, 3, 4).getTime() } }
    }
  )
  const view = render(viewOf(session, true))
  mounted.push(view)
  expect(view.queryByTitle("2024-01-02 03:04")).toBeNull()
  view.rerender(viewOf(session))
  const label = view.getByTitle("2024-01-02 03:04")
  expect(label.classList.contains("codex-user-time")).toBe(true)
  expect(label.parentElement?.querySelector("button")?.getAttribute("aria-label")).toBe("Copy")
})

test("commentary keeps non-text content and unknown blocks are visible", () => {
  const session = feed(addPrompt(createSession("mixed-commentary", "/tmp"), [{ type: "text", text: "go" }], "prompt"), {
    sessionUpdate: "agent_message",
    messageId: "comment",
    content: [
      { type: "text", text: "See" },
      { type: "resource_link", uri: "file:///tmp/result.txt", name: "result.txt" },
      { type: "future_block", value: 1 }
    ],
    _meta: { codex: { phase: "commentary" } }
  })
  const view = render(viewOf(session))
  mounted.push(view)
  const work = view.container.querySelector(".codex-work-body")
  expect(work?.textContent).toContain("See")
  expect(work?.textContent).toContain("result.txt")
  expect(work?.textContent).toContain("Unsupported content: future_block")
})

test("embedded binary content can be downloaded from its payload", () => {
  const session = feed(addPrompt(createSession("binary-answer", "/tmp"), [{ type: "text", text: "go" }], "prompt"), {
    sessionUpdate: "agent_message",
    messageId: "final",
    content: [
      {
        type: "resource",
        resource: { uri: "file:///tmp/result.bin", mimeType: "application/octet-stream", blob: "aGVsbG8=" }
      }
    ],
    _meta: { codex: { phase: "final_answer" } }
  })
  const view = render(viewOf(session))
  mounted.push(view)
  expect(view.getByRole("link", { name: "file:///tmp/result.bin" }).getAttribute("href")).toBe(
    "data:application/octet-stream;base64,aGVsbG8="
  )
})
