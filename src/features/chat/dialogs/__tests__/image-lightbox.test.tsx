import * as opener from "@tauri-apps/plugin-opener"
import { act, fireEvent, render, waitFor, within } from "@testing-library/react"
import { toast } from "sonner"
import { afterEach, expect, test, vi } from "vitest"

import { WorkspaceContext } from "@/features/workspace/context"
import { openPathInApp } from "@/lib/open-with-app"

import * as files from "../../file-actions"

vi.mock("@/lib/open-with-app", () => ({
  readAppsInfo: async () => [{ name: "Preview", bundle_id: "com.apple.Preview", icon: null }],
  openPathInApp: vi.fn().mockResolvedValue(undefined)
}))
vi.mock("@tauri-apps/plugin-opener", async (importOriginal) => ({ ...(await importOriginal<object>()) }))

import { initI18n } from "@/lib/i18n"

import { ImageLightbox, openImageLightbox } from "../image-lightbox"

await initI18n("en")
const mounted: Array<ReturnType<typeof render>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  await act(() => {
    return Promise.try(() => {
      for (const view of mounted.splice(0)) view.unmount()
    })
  })
})

test("image previews expose a visible close button and still close with Escape", async () => {
  const view = render(
    <>
      <button type="button" onClick={() => openImageLightbox("data:image/png;base64,test", "Portrait")}>
        Preview
      </button>
      <ImageLightbox />
    </>
  )
  mounted.push(view)
  fireEvent.click(view.getByRole("button", { name: "Preview" }))
  const dialog = view.getByRole("dialog")
  expect(dialog.querySelector("img")?.alt).toBe("Portrait")
  const close = within(dialog).getByRole("button", { name: "Close" })
  expect(close.querySelector("svg")).not.toBeNull()
  fireEvent.click(close)
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
  fireEvent.click(view.getByRole("button", { name: "Preview" }))
  fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" })
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
}, 15_000)

test("preview toolbar zooms, downloads the original, opens its local path and hands it to the side panel", async () => {
  const download = vi.spyOn(files, "downloadChatFile").mockResolvedValue(true)
  const open = vi.spyOn(opener, "openPath").mockResolvedValue()
  const openFile = vi.fn().mockResolvedValue(undefined)
  const view = render(
    <WorkspaceContext value={{ visible: false, toggle: vi.fn(), openFile, openProject: vi.fn(), revealEntry: vi.fn() }}>
      <ImageLightbox />
    </WorkspaceContext>
  )
  mounted.push(view)
  act(() => openImageLightbox("data:image/png;base64,aGVsbG8=", "Portrait", "/tmp/portrait.png"))
  const dialog = view.getByRole("dialog")
  fireEvent.click(within(dialog).getByRole("button", { name: "Zoom" }))
  fireEvent.click(view.getByRole("menuitemradio", { name: "200%" }))
  const image = dialog.querySelector("img") as HTMLImageElement
  Object.defineProperties(image, { naturalWidth: { value: 600 }, naturalHeight: { value: 400 } })
  fireEvent.load(image)
  expect(image.style.width).toBe("1200px")
  fireEvent.click(within(dialog).getByRole("button", { name: "Download portrait.png" }))
  await waitFor(() => expect(download).toHaveBeenCalledWith("/tmp/portrait.png", "aGVsbG8="))
  fireEvent.click(within(dialog).getByRole("button", { name: "Open" }))
  await waitFor(() => expect(open).toHaveBeenCalledWith("/tmp/portrait.png"))
  fireEvent.click(within(dialog).getByRole("button", { name: "Open with" }))
  fireEvent.click(await view.findByRole("menuitem", { name: "Preview" }))
  await waitFor(() => expect(openPathInApp).toHaveBeenCalledWith("com.apple.Preview", "/tmp/portrait.png"))
  fireEvent.click(within(dialog).getByRole("button", { name: "Open in side panel" }))
  await waitFor(() => expect(openFile).toHaveBeenCalledWith("/tmp/portrait.png", "/tmp"))
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
})

test("failed file actions report the error and keep the preview usable", async () => {
  vi.spyOn(files, "downloadChatFile").mockRejectedValue(new Error("Disk full"))
  const error = vi.spyOn(toast, "error").mockImplementation(() => "error")
  const openFile = vi.fn().mockRejectedValue(new Error("Cannot open workspace"))
  const view = render(
    <WorkspaceContext value={{ visible: false, toggle: vi.fn(), openFile, openProject: vi.fn(), revealEntry: vi.fn() }}>
      <ImageLightbox />
    </WorkspaceContext>
  )
  mounted.push(view)
  act(() => openImageLightbox("data:image/png;base64,aGVsbG8=", "Portrait", "/tmp/portrait.png"))
  fireEvent.click(view.getByRole("button", { name: "Download portrait.png" }))
  await waitFor(() => expect(error).toHaveBeenCalledWith("Disk full"))
  await waitFor(() => expect(view.getByRole("button", { name: "Open in side panel" })).not.toBeDisabled())
  fireEvent.click(view.getByRole("button", { name: "Open in side panel" }))
  await waitFor(() => expect(error).toHaveBeenCalledWith("Cannot open workspace"))
  expect(view.getByRole("dialog")).toBeDefined()
  fireEvent.click(view.getByRole("button", { name: "Close" }))
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
})

test("inline-only images disable local opening and reset zoom when another image opens", async () => {
  const view = render(<ImageLightbox />)
  mounted.push(view)
  act(() => openImageLightbox("data:image/png;base64,aGVsbG8=", "Inline"))
  expect(view.getByRole("button", { name: "Open" })).toBeDisabled()
  expect(view.getByRole("button", { name: "Open in side panel" })).toBeDisabled()
  fireEvent.click(view.getByRole("button", { name: "Zoom" }))
  fireEvent.click(view.getByRole("menuitemradio", { name: "200%" }))
  act(() => openImageLightbox("data:image/png;base64,bmV4dA==", "Next"))
  expect(view.getByRole("button", { name: "Zoom" }).textContent).toContain("Fit")
  fireEvent.click(view.getByRole("button", { name: "Close" }))
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
})
