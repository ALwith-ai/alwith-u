import { addPrompt, createSession } from "@alwith/module-chat/client"
import { drafts, formatMentionUri } from "@alwith/module-chat/conversation"
import { PhysicalPosition } from "@tauri-apps/api/dpi"
import type { getCurrentWebview } from "@tauri-apps/api/webview"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { Composer, renderTimeline } from "../../__tests__/timeline-host"

type DropHandler = Parameters<ReturnType<typeof getCurrentWebview>["onDragDropEvent"]>[0]
const native = vi.hoisted(() => ({
  listen: vi.fn<(listener: DropHandler) => Promise<() => void>>(),
  invoke:
    vi.fn<
      (
        command: string,
        args?: { path: string; allowDirectory?: boolean | null; localImage?: boolean | null }
      ) => Promise<unknown>
    >()
}))

vi.mock("@tauri-apps/api/webview", async (original) => ({
  ...(await original<object>()),
  getCurrentWebview: () => ({ onDragDropEvent: native.listen })
}))
vi.mock("@tauri-apps/plugin-log", () => ({ info: async () => {} }))

await initI18n("en")

afterEach(() => {
  cleanup()
  drafts.clear()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  Reflect.deleteProperty(document, "elementFromPoint")
})

const folder = "/tmp/项目 #1.png"
const secondFolder = "/tmp/Archive"
const regularFile = "/tmp/readme.md"
function session(id: string) {
  return { ...createSession(id, "/workspace"), attached: true }
}

function setup() {
  vi.stubGlobal("isTauri", true)
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke: native.invoke })
  native.listen.mockResolvedValue(() => {})
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "plugin:alwith-chat|read_dropped_file") {
      if ((args?.path === folder || args?.path === secondFolder) && args.allowDirectory)
        return { directory: true, path: args.path, image: null }
      return { path: regularFile, name: "readme.md", image: null, directory: false }
    }
  })
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => screen.getByRole("textbox")
  })
}

function drop(paths: string[]) {
  const listener = native.listen.mock.calls.at(-1)?.[0]
  if (!listener) throw new Error("Native drop listener has not been registered")
  act(() =>
    listener({
      event: "tauri://drag-drop",
      id: 1,
      payload: { type: "drop", paths, position: new PhysicalPosition(10, 20) }
    })
  )
}

test("a native mixed drop sends a folder reference alongside the ordinary file and request", async () => {
  setup()
  const submit = vi.fn(async () => {})
  render(<Composer session={session("folder-owner")} onSubmit={submit} />)
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Review these paths" } })

  drop([folder, regularFile, folder])

  const text = "Review these paths"
  const directory = { kind: "directory", absPath: folder } as const
  await waitFor(() => expect(drafts.get("folder-owner")?.mentions).toEqual([regularFile, directory]))
  const folderBadge = screen.getByRole("button", { name: "Remove 项目 #1.png" }).closest("[data-directory-reference]")
  expect(folderBadge?.querySelector(".lucide-folder")).toBeInTheDocument()
  expect(screen.getByRole("textbox")).toHaveValue(text)
  expect(
    native.invoke.mock.calls
      .filter(([command]) => command === "plugin:alwith-chat|read_dropped_file")
      .map(([, args]) => args)
  ).toEqual([
    { path: folder, localImage: true, allowDirectory: true },
    { path: regularFile, localImage: true, allowDirectory: true }
  ])
  expect(submit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith([
      { type: "resource_link", uri: formatMentionUri({ kind: "file", absPath: regularFile }), name: "readme.md" },
      { type: "resource_link", uri: "file:///tmp/%E9%A1%B9%E7%9B%AE%20%231.png/", name: "项目 #1.png" },
      { type: "text", text }
    ])
  )
})

test("one undo restores the draft before a folder batch and redo restores the whole batch", async () => {
  setup()
  const id = "folder-undo"
  render(<Composer session={session(id)} />)
  const editor = screen.getByRole("textbox")
  fireEvent.change(editor, { target: { value: "Keep this request" } })
  drop([folder])
  await waitFor(() => expect(screen.getByText("项目 #1.png")).toBeVisible())

  drop([secondFolder, folder, "/tmp/More"])
  await waitFor(() => expect(screen.getByText("Archive")).toBeVisible())
  expect(screen.getByText("readme.md")).toBeVisible()
  expect(screen.getAllByText("项目 #1.png")).toHaveLength(1)
  fireEvent.keyDown(editor, { key: "z", metaKey: true })
  expect(screen.queryByText("Archive")).not.toBeInTheDocument()
  expect(screen.getByText("项目 #1.png")).toBeVisible()
  expect(editor).toHaveValue("Keep this request")
  fireEvent.keyDown(editor, { key: "z", metaKey: true, shiftKey: true })
  expect(screen.getByText("Archive")).toBeVisible()
})

test("a failed folder send restores its card and request", async () => {
  setup()
  const submit = vi.fn(async () => {
    throw new Error("Could not submit the test request")
  })
  render(<Composer session={session("folder-failed")} onSubmit={submit} />)
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Review the directory" } })
  drop([folder])
  await waitFor(() => expect(screen.getByText("项目 #1.png")).toBeVisible())
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getByText("项目 #1.png")).toBeVisible())
  expect(screen.getByRole("textbox")).toHaveValue("Review the directory")
})

test("the timeline shows file and folder pills and the image separately from the request", () => {
  const uri = formatMentionUri({ kind: "directory", absPath: folder })
  const fileUri = formatMentionUri({ kind: "file", absPath: regularFile })
  const view = renderTimeline(
    addPrompt(
      session("folder-timeline"),
      [
        { type: "resource_link", uri: fileUri, name: "readme.md" },
        { type: "resource_link", uri, name: "项目 #1.png" },
        { type: "text", text: "Review the attachments" },
        { type: "image", uri: "file:///tmp/photo.png", mimeType: "image/png", data: "AA==" }
      ],
      "folder-message"
    )
  )
  const file = screen.getByRole("button", { name: "readme.md" })
  const directory = screen.getByRole("button", { name: "项目 #1.png" })
  expect(file).toHaveAttribute("title", fileUri)
  expect(directory).toHaveAttribute("title", uri)
  expect(file).toHaveClass("rounded-full")
  expect(directory).toHaveClass("rounded-full")
  expect(view.container.querySelector(".codex-user-image[data-local-image] img")).toBeInTheDocument()
  expect(view.container.querySelector("[data-user-message-bubble]")).toHaveTextContent(/^Review the attachments$/)
})

test("directory resolution after switching conversations leaves the new draft untouched", async () => {
  setup()
  const directory = Promise.withResolvers<{ directory: true; path: string }>()
  const invoke = native.invoke.getMockImplementation()!
  native.invoke.mockImplementation((command, args) =>
    command === "plugin:alwith-chat|read_dropped_file" && args?.path === folder
      ? directory.promise
      : invoke(command, args)
  )
  const view = render(<Composer session={session("first-folder-chat")} />)
  drop([folder])
  await waitFor(() =>
    expect(
      native.invoke.mock.calls.some(
        ([command, args]) => command === "plugin:alwith-chat|read_dropped_file" && args?.path === folder
      )
    ).toBe(true)
  )
  view.rerender(<Composer session={session("next-folder-chat")} />)
  await act(async () => directory.resolve({ directory: true, path: folder }))
  expect(drafts.get("first-folder-chat")?.text).toBe("")
  expect(drafts.get("first-folder-chat")?.mentions).toEqual([])
  expect(screen.getByRole("textbox")).toHaveValue("")
})
