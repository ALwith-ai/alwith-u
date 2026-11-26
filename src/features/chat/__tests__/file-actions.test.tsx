import { commands as fsCommands } from "@alwith/module-fs/commands"
import * as opener from "@tauri-apps/plugin-opener"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { toast } from "sonner"
import { afterEach, expect, test, vi } from "vitest"

import { WorkspaceContext } from "@/features/workspace/context"
import * as platform from "@/lib/platform"

import { ChatDirectoryContext, ChatOpenWebLinkContext, useOpenChatLink } from "../file-actions"

vi.mock("@tauri-apps/plugin-opener", async (original) => ({ ...(await original<object>()) }))
vi.mock("@/lib/platform", async (original) => ({ ...(await original<object>()) }))

afterEach(() => vi.restoreAllMocks())

function setup() {
  vi.spyOn(platform, "isMac").mockReturnValue(true)
  const open = vi.spyOn(opener, "openPath").mockResolvedValue()
  const openFile = vi.fn().mockResolvedValue(undefined)
  const wrapper = ({ children }: PropsWithChildren) => (
    <ChatDirectoryContext value="/repo">
      <WorkspaceContext
        value={{
          visible: false,
          toggle: vi.fn(),
          openFile: vi.fn(),
          openChatFile: openFile,
          openProject: vi.fn(),
          revealEntry: vi.fn()
        }}
      >
        {children}
      </WorkspaceContext>
    </ChatDirectoryContext>
  )
  return { ...renderHook(useOpenChatLink, { wrapper }), open, openFile }
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

test("a folder reference inside the project opens in the system file manager", async () => {
  const { result, open, openFile } = setup()
  act(() => result.current("file:///repo/%E5%BD%92%E6%A1%A3%20%231/"))
  await waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith("/repo/归档 #1/"))
  expect(openFile).not.toHaveBeenCalled()
})

test.each(["/outside/report.txt:9:4", "file:///outside/report.txt#L9C4", "FILE:///outside/report.txt#L9C4"])(
  "the main chat passes outside files and their position to the workspace: %s",
  async (link) => {
    const { result, openFile, open } = setup()
    act(() => result.current(link))
    await waitFor(() =>
      expect(openFile).toHaveBeenCalledExactlyOnceWith("/outside/report.txt", "/repo", { lineNumber: 9, column: 4 })
    )
    expect(open).not.toHaveBeenCalled()
  }
)

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

test.each(["folder", "report.html", "report.pdf", "archive.zip", "source.ts:9:4"])(
  "the floating chat delegates %s to the system without opening a workspace",
  async (link) => {
    const root = vi.spyOn(fsCommands, "workspaceOpen")
    const open = vi.spyOn(opener, "openPath").mockResolvedValue()
    const wrapper = ({ children }: PropsWithChildren) => (
      <ChatDirectoryContext value="/repo">{children}</ChatDirectoryContext>
    )
    const { result } = renderHook(useOpenChatLink, { wrapper })
    act(() => result.current(link))
    await waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith(`/repo/${link.split(":")[0]}`))
    expect(root).not.toHaveBeenCalled()
  }
)

test("the main chat opens an HTTP link through the embedded browser host", async () => {
  const openWeb = vi.fn().mockResolvedValue(undefined)
  const os = vi.spyOn(opener, "openUrl").mockResolvedValue()
  const wrapper = ({ children }: PropsWithChildren) => (
    <ChatOpenWebLinkContext value={openWeb}>{children}</ChatOpenWebLinkContext>
  )
  const { result } = renderHook(useOpenChatLink, { wrapper })
  act(() => result.current("www.example.com/report.pdf"))
  await waitFor(() => expect(openWeb).toHaveBeenCalledExactlyOnceWith("https://www.example.com/report.pdf"))
  expect(os).not.toHaveBeenCalled()
})

test("the floating chat reports a system open failure", async () => {
  vi.spyOn(opener, "openPath").mockRejectedValue(new Error("File does not exist"))
  const error = vi.spyOn(toast, "error").mockImplementation(() => "error")
  const { result } = renderHook(useOpenChatLink)
  act(() => result.current("/repo/missing.txt"))
  await waitFor(() => expect(error).toHaveBeenCalledExactlyOnceWith("File does not exist"))
})

test("an outside Markdown link reports the native error message", async () => {
  const { result, openFile } = setup()
  openFile.mockRejectedValue({ code: "permissionDenied", message: "Access to the archive was denied" })
  const error = vi.spyOn(toast, "error").mockImplementation(() => "error")
  act(() => result.current("file:///outside/%E5%BD%92%E6%A1%A3/report.md"))
  expect(openFile).toHaveBeenCalledExactlyOnceWith("/outside/归档/report.md", "/repo", undefined)
  await waitFor(() => expect(error).toHaveBeenCalledExactlyOnceWith("Access to the archive was denied"))
})
