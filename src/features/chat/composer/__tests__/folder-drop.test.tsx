import { createSession } from "@alwith/module-chat/client"
import { drafts, formatMentionUri } from "@alwith/module-chat/conversation"
import { PhysicalPosition } from "@tauri-apps/api/dpi"
import type { getCurrentWebview } from "@tauri-apps/api/webview"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { Composer } from "../../__tests__/timeline-host"

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
      if (args?.path === folder && args.allowDirectory)
        return { directory: true, path: folder, name: "项目 #1.png", image: null }
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

test("a native mixed drop inserts folder text and retains the ordinary file reference", async () => {
  setup()
  const submit = vi.fn(async () => {})
  render(<Composer session={session("folder-owner")} onSubmit={submit} />)
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Review these paths" } })

  drop([folder, regularFile, folder])

  const text = `Review these paths\n\n${folder}`
  await waitFor(() => expect(drafts.get("folder-owner")?.mentions).toEqual([regularFile]))
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
      { type: "text", text }
    ])
  )
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
  expect(screen.getByRole("textbox")).toHaveValue("")
})
