import { addPrompt, createSession, type ToolItem } from "@alwith/api"
import { formatMentionUri } from "@alwith/module-chat/conversation"
import { ResourceContent } from "@alwith/module-chat/resource-content"
import * as core from "@tauri-apps/api/core"
import { fireEvent, render, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { afterEach, expect, test, vi } from "vitest"

import { WorkspaceContext } from "@/features/workspace/context"
import { initI18n } from "@/lib/i18n"

import { ChatTimelineHost, renderTimeline, runningSession } from "../../__tests__/timeline-host"
import * as preview from "../../dialogs/file-preview-modal"
import { ImageLightbox } from "../../dialogs/image-lightbox"
import { ChatDirectoryContext } from "../../file-actions"

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({ ...(await importOriginal<object>()) }))

vi.mock("@tauri-apps/plugin-opener", async (importOriginal) => ({ ...(await importOriginal<object>()) }))

await initI18n("en")
const mocks: Array<{ mockRestore(): void }> = []
afterEach(() => {
  for (const mock of mocks.splice(0)) mock.mockRestore()
})

const blob = {
  type: "resource" as const,
  resource: { uri: "file:///tmp/photo.png", mimeType: "image/png", blob: "aGVsbG8=" }
}

test("generated images use a preview card and an icon download without size controls", () => {
  const view = render(
    <ChatTimelineHost>
      <ResourceContent block={blob} generated />
    </ChatTimelineHost>
  )
  expect(view.getByRole("button", { name: "View image" })).toBeDefined()
  const download = view.getByRole("button", { name: "Download photo.png" })
  expect(download.textContent).toBe("")
  expect(view.queryByText("Download at size")).toBeNull()
  expect(view.queryByRole("spinbutton")).toBeNull()
})

test("file references preserve encoded names, bare line locations and reserved filename characters", async () => {
  const path = vi.spyOn(preview, "openFilePreview").mockImplementation(() => {})
  mocks.push(path)
  const refs = [
    "README.md:12",
    "100%.pdf",
    "reports/report%20one.pdf",
    "reports/%E6%8A%A5%E5%91%8A.pdf",
    formatMentionUri({ kind: "file", absPath: "/tmp/a#b?c.pdf" })
  ]
  const view = render(
    <ChatDirectoryContext value="/tmp/project%20">
      <ChatTimelineHost>
        {refs.map((uri) => (
          <ResourceContent key={uri} block={{ type: "resource_link", uri, name: uri }} />
        ))}
      </ChatTimelineHost>
    </ChatDirectoryContext>
  )
  for (const uri of refs) fireEvent.click(view.getByRole("button", { name: uri }))
  await waitFor(() =>
    expect(path.mock.calls).toEqual([
      ["/tmp/project%20/README.md", { lineNumber: 12, column: 1 }],
      ["/tmp/project%20/100%.pdf", undefined],
      ["/tmp/project%20/reports/report one.pdf", undefined],
      ["/tmp/project%20/reports/报告.pdf", undefined],
      ["/tmp/a#b?c.pdf", undefined]
    ])
  )
})

test("download passes the exact payload to the native save dialog and reports failure", async () => {
  const invoke = vi.spyOn(core, "invoke").mockResolvedValue(false)
  const error = vi.spyOn(toast, "error").mockImplementation(() => "error")
  mocks.push(invoke, error)
  const view = render(
    <ChatTimelineHost>
      <ResourceContent block={blob} />
    </ChatTimelineHost>
  )
  const button = view.getByRole("button", { name: "Download photo.png" })
  fireEvent.click(button)
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("chat_save_file", { name: "photo.png", data: "aGVsbG8=" }))
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
  expect(error).not.toHaveBeenCalled()
  invoke.mockRejectedValue(new Error("Disk full"))
  fireEvent.click(button)
  await waitFor(() => expect(error).toHaveBeenCalledWith("Disk full"))
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
})

test("Blob images open the lightbox and undecodable images retain the download action", async () => {
  const view = render(
    <ChatTimelineHost>
      <ResourceContent block={blob} />
      <ImageLightbox />
    </ChatTimelineHost>
  )
  fireEvent.click(view.getByRole("button", { name: "View image" }))
  expect(view.getByRole("dialog").querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=")
  fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" })
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
  fireEvent.error(view.container.querySelector("img") as HTMLImageElement)
  expect(view.queryByRole("button", { name: "View image" })).toBeNull()
  expect(view.getByRole("button", { name: "Download photo.png" })).toBeDefined()
})

test("user references are clickable and resolve against their own thread directory", async () => {
  const path = vi.spyOn(preview, "openFilePreview").mockImplementation(() => {})
  const error = vi.spyOn(toast, "error").mockImplementation(() => "error")
  mocks.push(path, error)
  const session = addPrompt(
    createSession("owner", "/tmp/owner"),
    [{ type: "resource_link", uri: "reports/result.pdf", name: "result.pdf" }, blob],
    "prompt"
  )
  const view = renderTimeline(session)
  fireEvent.click(await view.findByRole("button", { name: "result.pdf" }))
  await waitFor(() => expect(path).toHaveBeenCalledWith("/tmp/owner/reports/result.pdf", undefined))
  expect(view.container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=")
})

test("tool resources expose Blob previews, file links and downloads", async () => {
  const path = vi.spyOn(preview, "openFilePreview").mockImplementation(() => {})
  mocks.push(path)
  const item: ToolItem = {
    id: "files",
    at: 1,
    replayed: false,
    _meta: null,
    kind: "tool",
    name: "export",
    title: "Export files",
    toolKind: "other",
    status: "completed",
    locations: [],
    rawInput: {},
    rawOutput: null,
    endedAt: 2,
    content: [
      { type: "content", content: blob },
      { type: "content", content: { type: "resource_link", uri: "file:///tmp/report.pdf", name: "report.pdf" } },
      {
        type: "content",
        content: {
          type: "resource",
          resource: { uri: "file:///tmp/movie.mp4", mimeType: "video/mp4", blob: "aGVsbG8=" }
        }
      }
    ]
  }
  const view = renderTimeline(runningSession("resource-content", "/tmp", [item]))
  // The activity lists the tool's files and the reply repeats them as results.
  expect(await view.findAllByRole("button", { name: "Download photo.png" })).not.toHaveLength(0)
  expect(view.getAllByRole("button", { name: "Download movie.mp4" })).not.toHaveLength(0)
  expect(view.container.querySelector("video")).toBeNull()
  fireEvent.click(view.getAllByRole("button", { name: "report.pdf" })[0])
  await waitFor(() => expect(path).toHaveBeenCalledWith("/tmp/report.pdf", undefined))
})

test("file links deliver the decoded path and line/column to the workspace", async () => {
  const openFile = vi.fn().mockResolvedValue(undefined)
  const view = render(
    <WorkspaceContext value={{ visible: true, toggle: vi.fn(), openFile, openProject: vi.fn(), revealEntry: vi.fn() }}>
      <ChatDirectoryContext value="/tmp/project">
        <ChatTimelineHost>
          <ResourceContent
            block={{ type: "resource_link", uri: "中文%20space%20%231.txt:2:3", name: "Located file" }}
          />
        </ChatTimelineHost>
      </ChatDirectoryContext>
    </WorkspaceContext>
  )
  fireEvent.click(view.getByRole("button", { name: "Located file" }))
  await waitFor(() =>
    expect(openFile).toHaveBeenCalledWith("/tmp/project/中文 space #1.txt", "/tmp/project", {
      lineNumber: 2,
      column: 3
    })
  )
  view.unmount()
})

test("replayed user images render thumbnails above the body without attachment paths", async () => {
  const session = addPrompt(
    createSession("images", "/tmp/project"),
    [
      { type: "text", text: "检测图片" },
      { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
      {
        type: "resource_link",
        name: "Image unavailable",
        uri: "codex-image:unavailable",
        _meta: { codex: { imageUnavailable: true } }
      }
    ],
    "image-prompt"
  )
  const view = renderTimeline(session, <ImageLightbox />)
  expect(await view.findByText("检测图片")).toBeDefined()
  expect(view.getByText("Image unavailable")).toBeDefined()
  expect(view.container.querySelector(".codex-user-images img")?.getAttribute("src")).toBe(
    "data:image/png;base64,aGVsbG8="
  )
  expect(view.queryByText(/Files mentioned|file:\/\/|codex-image:/)).toBeNull()
  expect(view.queryByRole("button", { name: "Image unavailable" })).toBeNull()
  fireEvent.click(view.getByRole("button", { name: "" }))
  expect(view.getByRole("dialog").querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=")
})

test("external file links bypass the project workspace and preserve line locations", async () => {
  const openFile = vi.fn().mockResolvedValue(undefined)
  const openPreview = vi.spyOn(preview, "openFilePreview").mockImplementation(() => {})
  mocks.push(openPreview)
  const view = render(
    <WorkspaceContext value={{ visible: true, toggle: vi.fn(), openFile, openProject: vi.fn(), revealEntry: vi.fn() }}>
      <ChatDirectoryContext value="/tmp/project">
        <ChatTimelineHost>
          <ResourceContent
            block={{
              type: "resource_link",
              uri: "file:///tmp/outside/%E4%B8%AD%E6%96%87%20%231.txt#L2C3",
              name: "External file"
            }}
          />
        </ChatTimelineHost>
      </ChatDirectoryContext>
    </WorkspaceContext>
  )
  fireEvent.click(view.getByRole("button", { name: "External file" }))
  await waitFor(() =>
    expect(openPreview).toHaveBeenCalledWith("/tmp/outside/中文 #1.txt", { lineNumber: 2, column: 3 })
  )
  expect(openFile).not.toHaveBeenCalled()
})

test.each([false, true])("questionnaire replies hide metadata (local receipt: %s)", async (receipt) => {
  const replies = [
    { question: "Focus Vibemon?", answer: "已点" },
    { question: "Files?", answer: "A.txt\nB.txt" }
  ]
  const session = addPrompt(
    createSession("questions", "/tmp/questions"),
    replies.map((reply) => ({
      type: "text",
      text: `${reply.question}\n${reply.answer}`,
      _meta: { codex: { questionReply: reply } }
    })),
    "replies"
  )
  const item = session.items.find((item) => item.kind === "user")
  if (item?.kind !== "user") throw new Error("User prompt is missing")
  const rendered = receipt
    ? {
        ...item,
        content: [
          {
            type: "text" as const,
            text: "<send_user_message_question_reply>raw payload</send_user_message_question_reply>"
          }
        ],
        _meta: {
          codex: { questionReplyParts: replies.map((reply) => ({ question: reply.question, text: reply.answer })) }
        }
      }
    : item
  const view = renderTimeline({ ...session, items: [rendered] })
  await view.findByText("已点")
  expect([...view.container.querySelectorAll(".codex-user-question-summary")].map((node) => node.textContent)).toEqual([
    "Focus Vibemon?",
    "Files?"
  ])
  expect(view.getByText("已点")).toBeDefined()
  expect(view.container.querySelectorAll(".codex-user-question-answer")[1]?.textContent).toBe("A.txt\nB.txt")
  expect(view.container.textContent).not.toMatch(/questionItemId|send_user_message_question_reply/)
})
