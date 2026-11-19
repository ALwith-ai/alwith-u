import { acknowledgePrompt, addPrompt, applyUpdate, createSession, type Session } from "@alwith/module-chat/client"
import { commands as chatCommands } from "@alwith/module-chat/commands"
import { ConversationBody, drafts } from "@alwith/module-chat/conversation"
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { generatedImageStorage } from "@/features/images/generated-image-storage"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { ChatHostProvider } from "../chat-host"
import { Composer, renderTimeline } from "./timeline-host"

await initI18n("en")
const initial = client.state
afterEach(() => {
  cleanup()
  client.store.setState(initial, true)
  drafts.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function feed(session: Session, ...updates: unknown[]) {
  return updates.reduce<Session>((state, update) => applyUpdate(state, update as never), session)
}
const user = (id: string, text: string, turnId: string) => ({
  sessionUpdate: "user_message",
  messageId: id,
  content: [{ type: "text", text }],
  _meta: { codex: { turnId } }
})
const answer = (id: string, text: string, turnId: string) => ({
  sessionUpdate: "agent_message",
  messageId: id,
  content: [{ type: "text", text }],
  _meta: { codex: { turnId, phase: "final_answer", messageCompleted: true } }
})
function compactSequence() {
  let session = feed(
    createSession("order-audit", "/tmp"),
    user("u1", "Earlier question", "t1"),
    answer("a1", "Earlier answer", "t1")
  )
  session = addPrompt(session, [{ type: "text", text: "/compact" }], "local")
  session = feed(session, {
    sessionUpdate: "user_message_chunk",
    messageId: "command",
    content: { type: "text", text: "/compact" }
  })
  session = acknowledgePrompt(session, "local", "command")
  return feed(
    session,
    { sessionUpdate: "compaction_update", compactionId: "compression", status: "completed" },
    user("u2", "Later question", "t2"),
    answer("a2", "Later answer", "t2")
  )
}
function precedes(before: Element, after: Element) {
  expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}

test.each([false, true])(
  "manual compaction keeps its position after another question (history indexed: %s)",
  (indexed) => {
    const session = compactSequence()
    if (indexed)
      client.store.setState({
        historyNavigation: {
          [session.id]: {
            turns: [{ turnId: "t1" }, { turnId: "t2" }],
            loadedTurnIds: ["t1", "t2"],
            complete: true,
            loading: false,
            error: null,
            turnErrors: {},
            previews: {}
          }
        }
      })
    const view = renderTimeline(session)
    precedes(view.getByText("Earlier answer"), view.getByText("/compact"))
    precedes(view.getByText("/compact"), view.getByText("Later question"))
    precedes(view.getByText("Context compacted"), view.getByText("Later question"))
  }
)

test("a generated tool image keeps its position before a later final message", () => {
  const session = feed(
    createSession("image-order-audit", "/tmp"),
    user("u1", "Draw", "t1"),
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "image",
      name: "generate_image",
      kind: "other",
      status: "completed",
      _meta: { codex: { turnId: "t1" } },
      content: [
        {
          type: "content",
          content: { type: "image", mimeType: "image/png", data: "aGVsbG8=", uri: "file:///tmp/generated.png" }
        }
      ]
    },
    answer("a1", "Explanation after image", "t1")
  )
  const view = renderTimeline(session)
  const image = view.container.querySelector(".codex-reply-artifacts img")
  expect(image).not.toBeNull()
  precedes(image!, view.getByText("Explanation after image"))
})

test("saved MCP images render during the turn and after replay, with original bytes for download", async () => {
  const reference = "generated_images/image-history/alwith-exec-image-1.png"
  const data = "aGVsbG8="
  const read = vi.spyOn(generatedImageStorage, "read").mockResolvedValue({ mimeType: "image/png", data })
  const save = vi.spyOn(chatCommands, "saveFile").mockResolvedValue(true)
  const session = feed(
    { ...createSession("image-history", "/tmp"), state: "running" },
    user("u1", "Generate", "t1"),
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "exec-image",
      title: "mcp.alwith.generate_image",
      kind: "execute",
      status: "completed",
      _meta: { codex: { turnId: "t1" } },
      rawInput: { server: "alwith", tool: "generate_image", arguments: { prompt: "Generate" } },
      rawOutput: {
        result: {
          content: [
            { type: "text", text: JSON.stringify({ kind: "alwith.image", images: [{ reference: "exec-image:1" }] }) },
            { type: "resource_link", uri: `alwith-generated-image:${reference}`, name: "alwith-exec-image-1.png" }
          ]
        },
        error: null
      }
    },
    answer("a1", `![Generated](exec-image:1)\n\n![Generated again](alwith-generated-image:${reference})`, "t1")
  )
  const live = renderTimeline(session)
  await live.findByRole("button", { name: "Download alwith-exec-image-1.png" })
  expect(live.container.querySelector(".codex-reply-artifacts img")).toHaveAttribute(
    "src",
    `data:image/png;base64,${data}`
  )
  expect(live.container.querySelectorAll("img")).toHaveLength(1)
  expect(live.queryByText("Generated again")).not.toBeInTheDocument()
  live.unmount()

  const replayed = renderTimeline({ ...(JSON.parse(JSON.stringify(session)) as Session), state: "idle" })
  fireEvent.click(await replayed.findByRole("button", { name: "Download alwith-exec-image-1.png" }))
  await waitFor(() => expect(save).toHaveBeenCalledWith({ name: "alwith-exec-image-1.png", data }))
  expect(read.mock.calls).toEqual([[reference], [reference]])
})

test.each(["image block", "local Markdown image", "Markdown table image"])(
  "the shared context menu attaches a generated %s without sending",
  async (kind) => {
    vi.stubGlobal("createImageBitmap", async () => ({ close() {} }))
    const id = "image-draft-owner"
    const image = { type: "image", mimeType: "image/png", data: "aGVsbG8=" }
    const promptImage = { ...image, data: "dXNlcg==" }
    const markdown = kind !== "image block"
    const reference = "![Generated image](/tmp/generated.png)"
    if (markdown) {
      vi.spyOn(chatCommands, "previewFile").mockResolvedValue({
        kind: "image",
        mimeType: image.mimeType,
        data: image.data
      })
    }
    const session = feed(
      { ...createSession(id, "/tmp"), attached: true },
      { ...user("u1", "Draw", "t1"), content: [promptImage, { type: "text", text: "Draw" }] },
      {
        ...answer("a1", "Generated", "t1"),
        content: markdown
          ? [
              {
                type: "text",
                text: kind === "Markdown table image" ? `| Image |\n| --- |\n| ${reference} |` : reference
              }
            ]
          : [image]
      }
    )
    client.store.setState({ connection: "ready", sessions: { [id]: session } })
    const submit = vi.fn(async () => {})
    const view = renderTimeline(session, <Composer session={session} onSubmit={submit} />, true)
    const input = view.getByRole("textbox")
    fireEvent.change(input, { target: { value: "Use this as reference" } })
    const otherDraft = { text: "Another chat", attachments: [], mentions: [], modelId: null }
    drafts.set("other-chat", otherDraft)

    const userImage = view.container.querySelector<HTMLImageElement>(
      `img[src="data:image/png;base64,${promptImage.data}"]`
    )!
    expect(fireEvent.contextMenu(userImage)).toBe(true)
    expect(view.queryByRole("menuitem")).toBeNull()

    const generatedImage =
      kind === "Markdown table image"
        ? await view.findByAltText("Generated image")
        : (await view.findByRole("button", { name: "View image" })).querySelector("img")!
    expect(fireEvent.contextMenu(generatedImage, { clientX: 80, clientY: 100 })).toBe(false)
    const item = await view.findByRole("menuitem", { name: "Add image to chat" })
    expect(item).toHaveAttribute("data-slot", "context-menu-item")
    fireEvent.click(item)
    expect(view.getByRole("button", { name: "Remove attachment" })).toBeInTheDocument()
    expect(drafts.get("other-chat")).toEqual(otherDraft)
    expect(input).toHaveValue("Use this as reference")
    expect(submit).not.toHaveBeenCalled()

    fireEvent.click(view.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith([{ type: "text", text: "Use this as reference" }, image]))
  }
)

test("subagent details stay at delegation rather than after later parent commentary", () => {
  const parent = feed(
    { ...createSession("parent-audit", "/tmp"), state: "running" },
    user("u1", "Delegate work", "t1"),
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "spawn",
      name: "subagent",
      kind: "other",
      status: "completed",
      _meta: { codex: { turnId: "t1" } },
      rawInput: {
        agentThreadId: "child-audit",
        agentPath: "/root/research",
        activity: "started",
        model: null,
        reasoningEffort: null
      }
    },
    {
      sessionUpdate: "agent_message",
      messageId: "after",
      content: [{ type: "text", text: "Parent commentary after delegation" }],
      _meta: { codex: { turnId: "t1", phase: "commentary" } }
    }
  )
  const child: Session = {
    ...createSession("child-audit", "/tmp", "Research"),
    state: "running",
    subagent: {
      parentId: parent.id,
      description: "Research",
      capabilities: null,
      _meta: { codex: { threadId: "child-audit", parentTurnId: "t1" } }
    }
  }
  client.store.setState({ sessions: { [parent.id]: parent, [child.id]: child } })
  const view = render(
    <ThemeProvider>
      <ChatHostProvider>
        <ConversationBody session={parent} />
      </ChatHostProvider>
    </ThemeProvider>
  )
  const details = view.container.querySelector("[data-subagent-sessions]")
  expect(details).not.toBeNull()
  precedes(details!, view.getByText("Parent commentary after delegation"))
})

test("an image splits consecutive tools before subsequent commentary, async text and the final answer", () => {
  const session = feed(
    { ...createSession("mixed-image-order", "/tmp"), state: "running" },
    user("u1", "Investigate and draw", "t1"),
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "before",
      title: "Inspect source first",
      kind: "other",
      status: "completed"
    },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "image",
      name: "generate_image",
      kind: "other",
      status: "completed",
      content: [
        {
          type: "content",
          content: { type: "image", mimeType: "image/png", data: "aGVsbG8=", uri: "file:///tmp/mixed.png" }
        }
      ]
    },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "after",
      title: "Verify image afterwards",
      kind: "other",
      status: "completed"
    },
    {
      sessionUpdate: "agent_message",
      messageId: "commentary",
      content: [{ type: "text", text: "Later commentary" }],
      _meta: { codex: { phase: "commentary" } }
    },
    {
      sessionUpdate: "agent_message",
      messageId: "async",
      content: [{ type: "text", text: "Appended async message" }],
      _meta: { codex: { delivery: "async" } }
    },
    answer("a1", "Final explanation", "t1")
  )
  const view = renderTimeline(session)
  const process = view.container.querySelector<HTMLButtonElement>(".codex-work-trigger[aria-expanded=false]")
  if (process) fireEvent.click(process)
  for (const group of view.container.querySelectorAll<HTMLButtonElement>(
    ".codex-activity-group-trigger[aria-expanded=false]"
  ))
    fireEvent.click(group)
  const image = view.container.querySelector(".codex-reply-artifacts img")!
  expect(image).not.toBeNull()
  const elements = [
    view.getByText("Inspect source first"),
    image,
    view.getByText("Verify image afterwards"),
    view.getByText("Later commentary"),
    view.getByText("Appended async message"),
    view.getByText("Final explanation")
  ]
  for (let index = 1; index < elements.length; index++) precedes(elements[index - 1]!, elements[index]!)
})

test("delegation after a steering message belongs to that segment even when the native turn is shared", () => {
  const parent = feed(
    { ...createSession("steered-parent", "/tmp"), state: "running" },
    user("first", "Original request", "t1"),
    answer("first-answer", "Before steering", "t1"),
    user("steer", "Steering request", "t1"),
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "spawn-steered",
      name: "subagent",
      kind: "other",
      status: "completed",
      _meta: { codex: { turnId: "t1" } },
      rawInput: {
        agentThreadId: "steered-child",
        agentPath: "/root/research",
        activity: "started",
        model: null,
        reasoningEffort: null
      }
    },
    {
      sessionUpdate: "agent_message",
      messageId: "after-steer",
      content: [{ type: "text", text: "After steered delegation" }],
      _meta: { codex: { turnId: "t1", phase: "commentary" } }
    }
  )
  const child: Session = {
    ...createSession("steered-child", "/tmp", "Research"),
    state: "running",
    subagent: {
      parentId: parent.id,
      description: "Research",
      capabilities: null,
      _meta: { codex: { threadId: "steered-child", parentTurnId: "t1" } }
    }
  }
  client.store.setState({ sessions: { [parent.id]: parent, [child.id]: child } })
  const view = render(
    <ThemeProvider>
      <ChatHostProvider>
        <ConversationBody session={parent} />
      </ChatHostProvider>
    </ThemeProvider>
  )
  const groups = view.container.querySelectorAll("[data-subagent-sessions]")
  expect(groups).toHaveLength(1)
  precedes(view.getByText("Steering request"), groups[0]!)
  precedes(groups[0]!, view.getByText("After steered delegation"))
})
