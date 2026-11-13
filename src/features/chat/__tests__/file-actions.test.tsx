import { commands as fsCommands } from "@alwith/module-fs/commands"
import * as opener from "@tauri-apps/plugin-opener"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { toast } from "sonner"
import { afterEach, expect, test, vi } from "vitest"

import { WorkspaceContext } from "@/features/workspace/context"
import * as platform from "@/lib/platform"

import * as preview from "../dialogs/file-preview-modal"
import { ChatDirectoryContext, useOpenChatLink } from "../file-actions"

vi.mock("@tauri-apps/plugin-opener", async (original) => ({ ...(await original<object>()) }))
vi.mock("@/lib/platform", async (original) => ({ ...(await original<object>()) }))
vi.mock("../dialogs/file-preview-modal", () => ({ openFilePreview: vi.fn() }))

afterEach(() => vi.restoreAllMocks())

function setup() {
  vi.spyOn(platform, "isMac").mockReturnValue(true)
  const open = vi.spyOn(opener, "openPath").mockResolvedValue()
  vi.spyOn(fsCommands, "workspaceOpen").mockImplementation(async ({ path }) => path)
  vi.spyOn(fsCommands, "workspaceStat").mockResolvedValue({ kind: "file", size: 100, version: "1" })
  const reveal = vi.spyOn(opener, "revealItemsInDir").mockResolvedValue()
  const openFile = vi.fn().mockResolvedValue(undefined)
  const wrapper = ({ children }: PropsWithChildren) => (
    <ChatDirectoryContext value="/repo">
      <WorkspaceContext
        value={{ visible: false, toggle: vi.fn(), openFile, openProject: vi.fn(), revealEntry: vi.fn() }}
      >
        {children}
      </WorkspaceContext>
    </ChatDirectoryContext>
  )
  return { ...renderHook(useOpenChatLink, { wrapper }), open, openFile, reveal }
}

test.each([
  "/repo/build/ALwith U Dev.app",
  "/repo/build/ALwith%20U%20Dev.app",
  "file:///repo/build/ALwith%20U%20Dev.app",
  "build/ALwith%20U%20Dev.app"
])("opens the application bundle with the system instead of the editor: %s", async (link) => {
  const { result, open, openFile } = setup()
  act(() => result.current(link))
  await waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith("/repo/build/ALwith U Dev.app"))
  expect(openFile).not.toHaveBeenCalled()
  expect(preview.openFilePreview).not.toHaveBeenCalled()
})

test("files inside an application bundle still open in the editor with their line position", async () => {
  const { result, open, openFile } = setup()
  act(() => result.current("/repo/build/ALwith%20U%20Dev.app/Contents/Info.plist:12"))
  await waitFor(() =>
    expect(openFile).toHaveBeenCalledExactlyOnceWith("/repo/build/ALwith U Dev.app/Contents/Info.plist", "/repo", {
      lineNumber: 12,
      column: 1
    })
  )
  expect(open).not.toHaveBeenCalled()
})

test.each(["/outside/report.txt:9:4", "file:///outside/report.txt#L9C4", "FILE:///outside/report.txt#L9C4"])(
  "outside files reveal in the system file manager without changing the project: %s",
  async (link) => {
    const { result, openFile, open, reveal } = setup()
    act(() => result.current(link))
    await waitFor(() => expect(reveal).toHaveBeenCalledExactlyOnceWith("/outside/report.txt"))
    expect(openFile).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    expect(preview.openFilePreview).not.toHaveBeenCalled()
  }
)

test("outside directories use the system file manager even with an HTML extension", async () => {
  const { result, openFile, open } = setup()
  vi.mocked(fsCommands.workspaceStat).mockResolvedValue({ kind: "directory", size: 0, version: "1" })
  act(() => result.current("/outside/directory.html"))
  await waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith("/outside/directory.html"))
  expect(openFile).not.toHaveBeenCalled()
})

test.each([
  "http://localhost:5173/",
  "https://example.com/report.pdf?download=1#page=3",
  "https://example.com/site.html",
  "https://example.com/image.png",
  "www.example.com"
])("web links use the external URL opener regardless of their file extension: %s", async (link) => {
  const { result, openFile, open } = setup()
  const url = vi.spyOn(opener, "openUrl").mockResolvedValue()
  act(() => result.current(link))
  await waitFor(() => expect(url).toHaveBeenCalledExactlyOnceWith(link.startsWith("www.") ? `https://${link}` : link))
  expect(openFile).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
})

test.each([
  "source.ts",
  "notes.md",
  "data.csv",
  "report.pdf",
  "sheet.xlsx",
  "photo.png",
  "video.mp4",
  "archive.zip",
  "unknown.custom"
])("local %s keeps the file workspace preview route", async (name) => {
  const { result, openFile, open } = setup()
  act(() => result.current(name))
  await waitFor(() => expect(openFile).toHaveBeenCalledExactlyOnceWith(`/repo/${name}`, "/repo", undefined))
  expect(open).not.toHaveBeenCalled()
})

test("surfaces without a file workspace still classify directories before opening", async () => {
  const root = vi.spyOn(fsCommands, "workspaceOpen").mockResolvedValue("/repo")
  const stat = vi.spyOn(fsCommands, "workspaceStat").mockResolvedValue({ kind: "directory", size: 0, version: "1" })
  const open = vi.spyOn(opener, "openPath").mockResolvedValue()
  const wrapper = ({ children }: PropsWithChildren) => (
    <ChatDirectoryContext value="/repo">{children}</ChatDirectoryContext>
  )
  const { result } = renderHook(useOpenChatLink, { wrapper })
  act(() => result.current("/repo/folder"))
  await waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith("/repo/folder"))
  expect(root).toHaveBeenCalledWith({ path: "/repo" })
  expect(stat).toHaveBeenCalledWith({ root: "/repo", path: "/repo/folder" })
  expect(preview.openFilePreview).not.toHaveBeenCalled()
})

test("missing paths report their resolved location without opening a preview", async () => {
  vi.spyOn(fsCommands, "workspaceOpen").mockResolvedValue("/repo")
  vi.spyOn(fsCommands, "workspaceStat").mockResolvedValue(null)
  const error = vi.spyOn(toast, "error").mockImplementation(() => "error")
  const wrapper = ({ children }: PropsWithChildren) => (
    <ChatDirectoryContext value="/repo">{children}</ChatDirectoryContext>
  )
  const { result } = renderHook(useOpenChatLink, { wrapper })
  act(() => result.current("missing.txt"))
  await waitFor(() => expect(error).toHaveBeenCalledExactlyOnceWith("Path does not exist: /repo/missing.txt"))
  expect(preview.openFilePreview).not.toHaveBeenCalled()
})
