import { addPrompt, applyUpdate, createSession, type Session } from "@alwith/api"
import { fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { must } from "@/lib/__tests__/must"
import { initI18n } from "@/lib/i18n"

import { groupTurns, turnTiming } from "../../turns"
import { AssistantTurn } from "../assistant-turn"

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
        sessionId={session.id}
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

const thought = (messageId: string, content: string) => ({
  sessionUpdate: "agent_thought_chunk",
  messageId,
  content: { type: "text", text: content }
})

test.each(["commentary", "final_answer"])("%s completes the preceding thought without expanding it", (phase) => {
  const id = crypto.randomUUID()
  let session = feed(createSession(id, "/tmp"), thought(id, "Inspecting the code"))
  const view = render(viewOf(session, true))
  mounted.push(view)
  expect(view.getByRole("button", { name: "Thinking" })).toHaveAttribute("aria-expanded", "false")
  session = feed(session, text(`${id}-message`, "Next step", phase))
  view.rerender(viewOf(session, true))
  expect(view.queryByRole("button", { name: "Thinking" })).toBeNull()
  expect(view.getByRole("button", { name: "Thought" })).toHaveAttribute("aria-expanded", "false")
  fireEvent.click(view.getByRole("button", { name: "Thought" }))
  expect(view.getByRole("button", { name: "Thought" })).toHaveAttribute("aria-expanded", "true")
  expect(view.getByText("Inspecting the code")).toBeDefined()
})

test("long turns finish older thoughts, retain every command and preserve explicit disclosure choices", () => {
  const id = crypto.randomUUID()
  let session = feed(createSession(id, "/tmp"), thought(`${id}-first`, "First thought"))
  const view = render(viewOf(session, true))
  mounted.push(view)
  session = feed(session, {
    sessionUpdate: "tool_call_update",
    toolCallId: `${id}-test`,
    name: "shell",
    kind: "execute",
    status: "in_progress",
    rawInput: { command: "bun run test" }
  })
  view.rerender(viewOf(session, true))
  expect(view.queryByRole("button", { name: "Thinking" })).toBeNull()
  expect(view.getByRole("button", { name: "Thought" })).toHaveAttribute("aria-expanded", "false")
  const liveGroup = must(view.container.querySelector(".codex-activity-group-trigger"), "the live group")
  expect(liveGroup).toHaveAttribute("aria-expanded", "false")
  fireEvent.click(liveGroup)
  expect(liveGroup).toHaveAttribute("aria-expanded", "true")
  session = feed(
    session,
    { sessionUpdate: "tool_call_update", toolCallId: `${id}-test`, status: "completed" },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: `${id}-build`,
      name: "shell",
      kind: "execute",
      status: "completed",
      rawInput: { command: "bun run build" }
    },
    thought(`${id}-second`, "Checking results")
  )
  view.rerender(viewOf(session, true))
  expect(view.getByRole("button", { name: "Thinking" })).toHaveAttribute("aria-expanded", "false")
  expect(view.getByRole("button", { name: "Thought" })).toHaveAttribute("aria-expanded", "false")
  session = feed(
    session,
    text(`${id}-comment`, "Tests completed", "commentary"),
    thought(`${id}-third`, "Preparing the answer")
  )
  view.rerender(viewOf(session, true))
  const previousGroup = must(view.container.querySelector(".codex-activity-group-trigger"), "the previous group")
  expect(previousGroup).toHaveAttribute("aria-expanded", "true")
  expect(view.getByRole("button", { name: "Thinking" })).toHaveAttribute("aria-expanded", "false")
  expect(view.getByRole("button", { name: "Ran bun run test" })).toBeDefined()
  expect(view.getByRole("button", { name: "Ran bun run build" })).toBeDefined()
  expect(view.getAllByRole("button", { name: "Thought" })).toHaveLength(2)

  // A late upsert must not make an older thought current or reopen its disclosure.
  session = feed(session, thought(`${id}-first`, " updated"))
  view.rerender(viewOf(session, true))
  expect(
    view.getAllByRole("button", { name: "Thought" }).every((button) => button.getAttribute("aria-expanded") === "false")
  ).toBe(true)
  expect(view.getByRole("button", { name: "Thinking" })).toHaveAttribute("aria-expanded", "false")
  expect(previousGroup).toHaveAttribute("aria-expanded", "true")

  view.rerender(viewOf(session, false))
  expect(view.getByRole("button", { name: /^Worked/ })).toHaveAttribute("aria-expanded", "false")
  expect(view.queryByRole("button", { name: "Thinking" })).toBeNull()
})

test("U keeps commentary after the last tool inside work, using the shared Desktop turn layout", () => {
  const session = feed(
    addPrompt(createSession("phase-layout", "/tmp"), [{ type: "text", text: "go" }], "prompt"),
    { sessionUpdate: "tool_call_update", toolCallId: "read", name: "read_file", kind: "read", status: "completed" },
    text("comment", "Still checking the result", "commentary"),
    text("final", "Here is the final answer", "final_answer")
  )
  const view = render(viewOf(session))
  mounted.push(view)
  expect(view.container.querySelector(".codex-work-body")?.textContent).toBe("")
  fireEvent.click(view.getByRole("button", { name: /^Worked/ }))
  expect(view.container.querySelector(".codex-work-body")?.textContent).toContain("Still checking the result")
  expect(view.container.querySelector(".codex-final-answer")?.textContent).toContain("Here is the final answer")
  expect(view.container.querySelector(".codex-final-answer")?.textContent).not.toContain("Still checking the result")
  expect(view.getAllByRole("button", { name: "Copy" }).length).toBe(1)
})

test("startup diagnostics stay outside chat while session notices remain visible", () => {
  const session = feed(
    createSession("startup", "/tmp"),
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "mcp-startup:yup-drive",
      name: "mcp_startup",
      title: "Start MCP server yup-drive",
      kind: "other",
      status: "failed",
      content: [{ type: "content", content: { type: "text", text: "MCP startup timed out" } }]
    },
    {
      sessionUpdate: "agent_message_chunk",
      messageId: "notice",
      content: { type: "text", text: "Warning: model changed" },
      _meta: { codex: { notice: true } }
    }
  )
  const view = render(viewOf(session))
  mounted.push(view)
  expect(view.getByRole("status").textContent).toContain("Warning: model changed")
  expect(view.queryByText("Start MCP server yup-drive")).toBeNull()
  expect(view.container.querySelector(".codex-work-section")).toBeNull()
  expect(view.container.querySelector(".codex-final-answer")).toBeNull()
  expect(view.queryByRole("button", { name: "Copy" })).toBeNull()
})

test("real assistant history without a user still renders as a reply", () => {
  const session = feed(createSession("orphan-answer", "/tmp"), text("answer", "Preserved reply", "final_answer"))
  const view = render(viewOf(session))
  mounted.push(view)
  expect(view.queryByRole("status")).toBeNull()
  expect(view.getByText("Preserved reply")).toBeDefined()
  expect(view.getByRole("button", { name: "Copy" })).toBeDefined()
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

test("a transcript error stays on its original turn, has no answer actions, and deduplicates the current error", () => {
  const failure = { message: "At capacity", category: "overloaded", retryable: true }
  const session = feed(addPrompt(createSession("retained-failure", "/tmp"), [{ type: "text", text: "go" }], "prompt"), {
    sessionUpdate: "agent_message",
    messageId: "codex-error:failed",
    content: [{ type: "text", text: failure.message }],
    _meta: { codex: { turnId: "failed", error: failure } }
  })
  const error = { stopReason: "error", error: { code: -32603, message: failure.message }, meta: null }
  const view = render(viewOf(session, false, error))
  mounted.push(view)
  expect(view.getAllByRole("alert")).toHaveLength(1)
  expect(view.queryByRole("button", { name: "Copy" })).toBeNull()
  view.rerender(viewOf(session, false, null, false))
  expect(view.getByRole("alert").textContent).toContain("At capacity")
})

test("completed compaction stays visible without a work disclosure and errors stay on their turn", () => {
  const session = feed(
    addPrompt(createSession("compaction-layout", "/tmp"), [{ type: "text", text: "go" }], "prompt"),
    { sessionUpdate: "compaction_update", compactionId: "compact", status: "completed" },
    text("final", "Preserved answer", "final_answer")
  )
  const error = {
    stopReason: "error",
    error: { code: -32603, message: "Gateway unavailable", data: { codex: { retryable: true } } },
    meta: null
  }
  const view = render(viewOf(session, false, error))
  mounted.push(view)
  expect(view.queryByRole("button", { name: /^Worked/ })).toBeNull()
  expect(view.getByText("Context compacted")).toBeVisible()
  expect(view.getByRole("alert").textContent).toContain("Gateway unavailable")
  view.rerender(viewOf(session, false, error, false))
  expect(view.queryByRole("alert")).toBeNull()
  expect(view.getByText("Preserved answer")).toBeDefined()
})

test("standalone completed compactions render only their notices without timing or answer actions", () => {
  const session = feed(
    createSession("compaction-notices", "/tmp"),
    { sessionUpdate: "compaction_update", compactionId: "first", status: "completed" },
    { sessionUpdate: "compaction_update", compactionId: "second", status: "completed" }
  )
  const view = render(viewOf(session))
  mounted.push(view)
  expect(view.getAllByText("Context compacted")).toHaveLength(2)
  expect(view.queryByRole("button")).toBeNull()
  expect(view.container.querySelector(".codex-work-section")).toBeNull()
  expect(view.container.querySelector(".codex-user-time")).toBeNull()
})

test.each(["Compaction service unavailable", null])(
  "failed compaction replaces progress and retains its error: %s",
  (error) => {
    let session = feed(
      addPrompt(createSession("compaction-failure", "/tmp"), [{ type: "text", text: "go" }], "prompt"),
      { sessionUpdate: "compaction_update", compactionId: "compact", status: "in_progress" }
    )
    const view = render(viewOf(session, true))
    mounted.push(view)
    expect(view.getByText("Compacting context")).toBeDefined()
    session = feed(session, { sessionUpdate: "compaction_update", compactionId: "compact", status: "failed", error })
    view.rerender(viewOf(session, true))
    expect(view.getByRole("alert").textContent).toContain("Context compaction failed")
    if (error !== null) expect(view.getByRole("alert").textContent).toContain(error)
    expect(view.queryByText("Compacting context")).toBeNull()
    expect(view.queryByText("Context compacted")).toBeNull()

    view.rerender(viewOf(session, false, null, false))
    fireEvent.click(view.getByRole("button", { name: /^Worked/ }))
    expect(view.getByRole("alert").textContent).toContain("Context compaction failed")
    if (error !== null) expect(view.getByRole("alert").textContent).toContain(error)
  }
)

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
      (element) => element.textContent || element.tagName
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

test("generated tool images stay visible in the reply when work is collapsed, including history replay", () => {
  const session = feed(
    addPrompt(createSession("generated-answer", "/tmp"), [{ type: "text", text: "Draw a portrait" }], "prompt"),
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "generated",
      name: "image_generation",
      kind: "other",
      status: "completed",
      content: [
        {
          type: "content",
          content: { type: "image", data: "aGVsbG8=", mimeType: "image/png", uri: "file:///tmp/portrait.png" }
        }
      ]
    },
    text("final", "Portrait generated", "final_answer")
  )
  const view = render(viewOf(session))
  mounted.push(view)
  const answer =
    view.container.querySelector(".codex-assistant-turn > .codex-final-answer") ??
    view.container.querySelector(".codex-assistant-turn > div:last-child")
  expect(answer?.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=")
  expect(view.getByRole("button", { name: "Download portrait.png" })).toBeDefined()
  view.rerender(viewOf({ ...session, items: session.items.map((item) => ({ ...item, replayed: true })) }))
  expect(view.container.querySelectorAll(".codex-reply-artifacts img").length).toBe(1)
})

test("generated images already present as final image or Blob are not repeated", () => {
  for (const block of [
    { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    { type: "resource", resource: { uri: "file:///tmp/portrait.png", blob: "aGVsbG8=", mimeType: "image/png" } }
  ]) {
    const session = feed(
      addPrompt(createSession("dedup-answer", "/tmp"), [{ type: "text", text: "draw" }], "prompt"),
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "generated",
        name: "image_generation",
        kind: "other",
        status: "completed",
        content: [{ type: "content", content: { type: "image", data: "aGVsbG8=", mimeType: "image/png" } }]
      },
      {
        sessionUpdate: "agent_message",
        messageId: "final",
        content: [block],
        _meta: { codex: { phase: "final_answer" } }
      }
    )
    const view = render(viewOf(session))
    mounted.push(view)
    expect(view.container.querySelectorAll(".codex-final-answer img").length).toBe(1)
    expect(view.container.querySelector(".codex-reply-artifacts")).toBeNull()
    view.unmount()
  }
})

test("failed image generation and viewed input images are not promoted to the reply", () => {
  for (const [name, status] of [
    ["image_generation", "failed"],
    ["view_image", "completed"]
  ]) {
    const session = feed(
      addPrompt(createSession("non-artifact", "/tmp"), [{ type: "text", text: "go" }], "prompt"),
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "image",
        name,
        kind: "read",
        status,
        content: [{ type: "content", content: { type: "image", data: "aGVsbG8=", mimeType: "image/png" } }]
      },
      text("final", "Result", "final_answer")
    )
    const view = render(viewOf(session))
    mounted.push(view)
    expect(view.container.querySelector(".codex-reply-artifacts")).toBeNull()
    expect(view.container.querySelector(".codex-final-answer img")).toBeNull()
    view.unmount()
  }
})

test("completed replies show the original batch time in the shared action bar", () => {
  const session = feed(
    { ...createSession("original-time", "/tmp"), restoring: true },
    {
      sessionUpdate: "agent_message",
      messageId: "final",
      content: [{ type: "text", text: "Answer" }],
      _meta: { codex: { phase: "final_answer", turnCompletedAt: new Date(2024, 0, 2, 3, 4).getTime() } }
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
  fireEvent.click(view.getByRole("button", { name: /^Worked/ }))
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
  expect(view.getByRole("button", { name: "Download result.bin" })).toBeDefined()
})

test("embedded Blob images render a preview and retain their download action", () => {
  const session = feed(addPrompt(createSession("blob-image", "/tmp"), [{ type: "text", text: "go" }], "prompt"), {
    sessionUpdate: "agent_message",
    messageId: "final",
    content: [
      { type: "resource", resource: { uri: "file:///tmp/photo.png", mimeType: "image/png", blob: "aGVsbG8=" } }
    ],
    _meta: { codex: { phase: "final_answer" } }
  })
  const view = render(viewOf(session))
  mounted.push(view)
  expect(view.container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=")
  expect(view.getByRole("button", { name: "View image" })).toBeDefined()
  expect(view.getByRole("button", { name: "Download photo.png" })).toBeDefined()
})

test("an interrupted historical turn explains missing partial output without fabricating a reply", () => {
  const session = feed(createSession("interrupted-history", "/tmp"), {
    sessionUpdate: "user_message",
    messageId: "u",
    content: [{ type: "text", text: "long answer" }],
    _meta: { codex: { turnId: "t", historyInterrupted: true } }
  })
  const view = render(viewOf(session))
  mounted.push(view)
  expect(view.getByRole("status").textContent).toContain("Codex history may not contain the unfinished response")
  expect(view.queryByRole("button", { name: "Copy" })).toBeNull()
})

test("history uses native duration even when replay items lack the runtime replay flag", () => {
  const session = feed(createSession("native-duration", "/tmp"), text("work", "Checking", "commentary"), {
    sessionUpdate: "agent_message",
    messageId: "historic-final",
    content: [{ type: "text", text: "Done" }],
    _meta: { codex: { phase: "final_answer", historyReplay: true, turnDurationMs: 123000 } }
  })
  expect(turnTiming(groupTurns(session)[0]).durationMs).toBe(123000)
  const view = render(viewOf(session))
  mounted.push(view)
  expect(view.getByRole("button", { name: /^Total time/ }).textContent).not.toBe("Total time 1s")
})

test("history without native timing shows Worked without a fabricated one-second duration", () => {
  const session = feed(createSession("unknown-duration", "/tmp"), text("work", "Checking", "commentary"), {
    sessionUpdate: "agent_message",
    messageId: "historic-final",
    content: [{ type: "text", text: "Done" }],
    _meta: { codex: { phase: "final_answer", historyReplay: true } }
  })
  expect(turnTiming(groupTurns(session)[0]).durationMs).toBeUndefined()
  const view = render(viewOf(session))
  mounted.push(view)
  expect(view.getByRole("button", { name: "Worked" })).toBeDefined()
  expect(view.queryByRole("button", { name: /^Worked for/ })).toBeNull()
})
