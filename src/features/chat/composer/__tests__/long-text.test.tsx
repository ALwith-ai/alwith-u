import { createSession } from "@nyssance/codex-acp-v2/client";
import { drafts, exportDraft, importDraft, isPastedTextAttachment } from "@alwith/module-chat/conversation"
import { act, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { commands } from "@/bindings"
import { initI18n } from "@/lib/i18n"

import { Composer } from "../../__tests__/timeline-host"
import * as preview from "../../dialogs/file-preview-modal"

await initI18n("en")
const session = (id = "paste-session") => ({ ...createSession(id, "/tmp"), attached: true })
const longText = "中文".repeat(2500)

beforeEach(() => {
  vi.spyOn(commands, "chatWriteTextAttachment").mockResolvedValue("/tmp/paste #1?.txt")
})
afterEach(() => {
  vi.restoreAllMocks()
  drafts.clear()
})

function paste(text: string, input = screen.getByRole("textbox")) {
  const event = createEvent.paste(input, {
    clipboardData: { items: [], getData: (type: string) => (type === "text/plain" ? text : "") }
  })
  fireEvent(input, event)
  return event
}

test("converts a single 5000-character paste, not 4999 characters or accumulated input", async () => {
  const submit = vi.fn().mockResolvedValue(undefined)
  render(<Composer session={session()} onSubmit={submit} />)
  const input = screen.getByRole("textbox")
  fireEvent.change(input, { target: { value: "existing prompt" } })
  expect(paste("中".repeat(4999)).defaultPrevented).toBe(false)
  expect(commands.chatWriteTextAttachment).not.toHaveBeenCalled()
  expect(paste(longText).defaultPrevented).toBe(true)
  expect(input).toHaveValue("existing prompt")
  await screen.findByText("5000 characters")
  expect(commands.chatWriteTextAttachment).toHaveBeenCalledWith({ name: "pasted-text.txt", text: longText })
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith([
      { type: "text", text: "existing prompt" },
      { type: "resource_link", uri: "file:///tmp/paste%20%231%3F.txt", name: "Pasted text.txt" }
    ])
  )
  await waitFor(() => expect(screen.queryByText("5000 characters")).not.toBeInTheDocument())
  expect(input).toHaveValue("")
})

test("uses UTF-16 length for emoji and leaves long typed text inline at submission", async () => {
  const submit = vi.fn().mockResolvedValue(undefined)
  render(<Composer session={session()} onSubmit={submit} />)
  expect(paste("😀".repeat(2499)).defaultPrevented).toBe(false)
  expect(paste("😀".repeat(2500)).defaultPrevented).toBe(true)
  await screen.findByText("5000 characters")
  fireEvent.click(screen.getByRole("button", { name: "Remove pasted text attachment" }))
  const text = "typed".repeat(10000)
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } })
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  await waitFor(() => expect(submit).toHaveBeenCalledWith([{ type: "text", text }]))
  expect(commands.chatWriteTextAttachment).toHaveBeenCalledTimes(1)
})

test("blocks submission while writing and routes completion to the original draft after switching chats", async () => {
  let finish!: (path: string) => void
  vi.mocked(commands.chatWriteTextAttachment).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    })
  )
  const view = render(<Composer key="a" session={session("a")} />)
  paste(longText)
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
  view.rerender(<Composer key="b" session={session("b")} />)
  expect(screen.queryByText("Adding pasted text…")).not.toBeInTheDocument()
  await act(() => Promise.try(() => finish("/tmp/a.txt")))
  expect(drafts.get("b")?.attachments).toHaveLength(0)
  view.rerender(<Composer key="a" session={session("a")} />)
  await screen.findByText("5000 characters")
  expect(screen.getByRole("button", { name: "Send" })).toBeEnabled()
})

test("waits for native writes when transferring a prepared draft to another window", async () => {
  let finish!: (path: string) => void
  vi.mocked(commands.chatWriteTextAttachment).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    })
  )
  render(<Composer session={session()} />)
  paste(longText)
  const originalDraft = drafts.get("paste-session")
  if (!originalDraft) throw new Error("Missing source draft")
  importDraft("prepared", originalDraft)
  const transferred = exportDraft("prepared")
  await act(() => Promise.try(() => finish("/tmp/transferred.txt")))
  const draft = await transferred
  if (!draft) throw new Error("Missing transferred draft")
  const file = draft.attachments[0]
  expect(isPastedTextAttachment(file) && file.pastedText.status).toBe("ready")
  expect(file.url).toBe("file:///tmp/transferred.txt")
  expect(isPastedTextAttachment(file) && file.pastedText.text).toBe(longText)
})

test("retries failed writes and opens the attachment as a file without changing the input", async () => {
  const openPreview = vi.spyOn(preview, "openFilePreview").mockImplementation(() => {})
  vi.mocked(commands.chatWriteTextAttachment).mockRejectedValueOnce(new Error("disk full"))
  render(<Composer session={session()} />)
  paste(longText)
  await screen.findByText("Could not create file")
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Retry creating text attachment" }))
  await screen.findByText("5000 characters")
  const input = screen.getByRole("textbox")
  fireEvent.change(input, { target: { value: "read this file" } })
  fireEvent.click(screen.getByRole("button", { name: /Pasted text.txt/ }))
  await waitFor(() => expect(openPreview).toHaveBeenCalledWith("/tmp/paste #1?.txt", undefined))
  expect(input).toHaveValue("read this file")
  expect(screen.queryByRole("button", { name: "Show in text field" })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Remove pasted text attachment" })).toBeInTheDocument()
})

test("does not resurrect an attachment removed before the native write finishes", async () => {
  let finish!: (path: string) => void
  vi.mocked(commands.chatWriteTextAttachment).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    })
  )
  render(<Composer session={session()} />)
  paste(longText)
  fireEvent.click(screen.getByRole("button", { name: "Remove pasted text attachment" }))
  await act(() => Promise.try(() => finish("/tmp/removed.txt")))
  expect(drafts.get("paste-session")?.attachments).toHaveLength(0)
  expect(screen.queryByText("5000 characters")).not.toBeInTheDocument()
})

test("retains the file and prompt when sending fails", async () => {
  const submit = vi.fn().mockRejectedValue(new Error("offline"))
  render(<Composer session={session()} onSubmit={submit} />)
  paste(longText)
  await screen.findByText("5000 characters")
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "keep me" } })
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled())
  expect(screen.getByRole("textbox")).toHaveValue("keep me")
  expect(screen.getByText("5000 characters")).toBeInTheDocument()
})
