import * as core from "@tauri-apps/api/core"
import * as opener from "@tauri-apps/plugin-opener"
import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { initI18n } from "@/lib/i18n"
import { FilePreviewModal, openFilePreview } from "../file-preview-modal"

vi.mock("@tauri-apps/api/core", async importOriginal => ({ ...(await importOriginal<object>()) }))
vi.mock("@tauri-apps/plugin-opener", async importOriginal => ({ ...(await importOriginal<object>()) }))

await initI18n("en")
afterEach(() => vi.restoreAllMocks())

test("previews a selected external file read-only and provides explicit system actions", async () => {
  const invoke = vi.spyOn(core, "invoke").mockResolvedValue({ kind: "text", text: "external content" })
  const reveal = vi.spyOn(opener, "revealItemsInDir").mockResolvedValue()
  const open = vi.spyOn(opener, "openPath").mockResolvedValue()
  act(() => openFilePreview("/outside/中文 #1.txt"))
  const view = render(<FilePreviewModal />)
  await view.findByText("external content")
  expect(invoke).toHaveBeenCalledWith("chat_preview_file", { path: "/outside/中文 #1.txt" })
  expect(view.queryByRole("textbox")).toBeNull()
  expect(open).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole("button", { name: "Show in file manager" }))
  expect(reveal).toHaveBeenCalledWith("/outside/中文 #1.txt")
  fireEvent.click(view.getByRole("button", { name: "Open with system app" }))
  expect(open).toHaveBeenCalledWith("/outside/中文 #1.txt")
})

test("late reads cannot replace a newly selected file; errors remain visible", async () => {
  let complete: (value: unknown) => void = () => {}
  vi.spyOn(core, "invoke")
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          complete = resolve
        })
    )
    .mockResolvedValueOnce({ kind: "image", mimeType: "image/png", data: "cG5n" })
    .mockRejectedValueOnce(new Error("File no longer exists"))
  act(() => openFilePreview("/outside/first.txt"))
  const view = render(<FilePreviewModal />)
  act(() => openFilePreview("/outside/second.png"))
  await waitFor(() => expect(view.getByRole("dialog").querySelector("img")).not.toBeNull())
  await act(async () => complete({ kind: "text", text: "stale" }))
  expect(view.queryByText("stale")).toBeNull()
  act(() => openFilePreview("/outside/missing.txt"))
  await view.findByRole("alert")
  expect(view.getByText("File no longer exists")).toBeDefined()
})
