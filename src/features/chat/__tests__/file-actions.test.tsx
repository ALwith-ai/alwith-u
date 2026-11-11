import * as opener from "@tauri-apps/plugin-opener"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { PropsWithChildren } from "react"
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
