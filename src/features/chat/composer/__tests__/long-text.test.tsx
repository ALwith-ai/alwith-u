import { createSession } from "@alwith/module-chat/client"
import { commands } from "@alwith/module-chat/commands"
import { drafts, exportDraft, importDraft, isPastedTextAttachment } from "@alwith/module-chat/conversation"
import * as opener from "@tauri-apps/plugin-opener"
import { act, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { Composer } from "../../__tests__/timeline-host"

vi.mock("@tauri-apps/plugin-opener", async (original) => ({ ...(await original<object>()) }))

await initI18n("en")
const session = (id = "paste-session") => ({ ...createSession(id, "/tmp"), attached: true })
const longText = "中文".repeat(2500)

beforeEach(() => {
  vi.spyOn(commands, "writeTextAttachment").mockResolvedValue("/tmp/paste #1?.txt")
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
  if (input instanceof HTMLTextAreaElement && !event.defaultPrevented) {
    const { selectionStart, selectionEnd, value } = input
    fireEvent.input(input, { target: { value: value.slice(0, selectionStart) + text + value.slice(selectionEnd) } })
  }
  return event
}

const windowsFiles = [
  [String.raw`C:\Users\Test\Downloads\function list.xlsx`, "file:///C:/Users/Test/Downloads/function%20list.xlsx"],
  [String.raw`\\server\share\报告 #1%.xlsx`, "file://server/share/%E6%8A%A5%E5%91%8A%20%231%25.xlsx"],
  [String.raw`\\?\C:\Users\Test\pasted-text.txt`, "file:///C:/Users/Test/pasted-text.txt"]
] as const

test.each(windowsFiles)("submits a Windows file reference with a valid URI: %s", async (path, uri) => {
  const submit = vi.fn().mockResolvedValue(undefined)
  drafts.set("paste-session", { text: "read this", attachments: [], mentions: [path], modelId: null })
  render(<Composer session={session()} onSubmit={submit} />)
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith([
      { type: "resource_link", uri, name: path.split("\\").at(-1) },
      { type: "text", text: "read this" }
    ])
  )
  expect(new URL(uri).protocol).toBe("file:")
})

test.each(windowsFiles)("submits a native Windows text attachment with a valid URI: %s", async (path, uri) => {
  vi.mocked(commands.writeTextAttachment).mockResolvedValue(path)
  const submit = vi.fn().mockResolvedValue(undefined)
  render(<Composer session={session()} onSubmit={submit} />)
  paste(longText)
  await screen.findByText("5000 characters")
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  await waitFor(() => expect(submit).toHaveBeenCalledWith([{ type: "resource_link", uri, name: "Pasted text.txt" }]))
})

test("converts a single 5000-character paste, not 4999 characters or accumulated input", async () => {
  const submit = vi.fn().mockResolvedValue(undefined)
  render(<Composer session={session()} onSubmit={submit} />)
  const input = screen.getByRole("textbox")
  fireEvent.change(input, { target: { value: "existing prompt" } })
  const shortPaste = "中".repeat(4999)
  paste(shortPaste)
  expect(input).toHaveValue(`existing prompt${shortPaste}`)
  expect(commands.writeTextAttachment).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: "existing prompt" } })
  expect(paste(longText).defaultPrevented).toBe(true)
  expect(input).toHaveValue("existing prompt")
  await screen.findByText("5000 characters")
  expect(commands.writeTextAttachment).toHaveBeenCalledWith({ name: "pasted-text.txt", text: longText })
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
  const shortPaste = "😀".repeat(2499)
  paste(shortPaste)
  expect(screen.getByRole("textbox")).toHaveValue(shortPaste)
  expect(paste("😀".repeat(2500)).defaultPrevented).toBe(true)
  await screen.findByText("5000 characters")
  fireEvent.click(screen.getByRole("button", { name: "Remove pasted text attachment" }))
  const text = "typed".repeat(10000)
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } })
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  await waitFor(() => expect(submit).toHaveBeenCalledWith([{ type: "text", text }]))
  expect(commands.writeTextAttachment).toHaveBeenCalledTimes(1)
})

test("blocks submission while writing and routes completion to the original draft after switching chats", async () => {
  let finish!: (path: string) => void
  vi.mocked(commands.writeTextAttachment).mockReturnValue(
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
  vi.mocked(commands.writeTextAttachment).mockReturnValue(
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
  const openFile = vi.spyOn(opener, "openPath").mockResolvedValue()
  vi.mocked(commands.writeTextAttachment).mockRejectedValueOnce(new Error("disk full"))
  render(<Composer session={session()} />)
  paste(longText)
  await screen.findByText("Could not create file")
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Retry creating text attachment" }))
  await screen.findByText("5000 characters")
  const input = screen.getByRole("textbox")
  fireEvent.change(input, { target: { value: "read this file" } })
  fireEvent.click(screen.getByRole("button", { name: /Pasted text.txt/ }))
  await waitFor(() => expect(openFile).toHaveBeenCalledWith("/tmp/paste #1?.txt"))
  expect(input).toHaveValue("read this file")
  expect(screen.queryByRole("button", { name: "Show in text field" })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Remove pasted text attachment" })).toBeInTheDocument()
})

test("does not resurrect an attachment removed before the native write finishes", async () => {
  let finish!: (path: string) => void
  vi.mocked(commands.writeTextAttachment).mockReturnValue(
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
