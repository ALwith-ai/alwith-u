import type { ToolItem } from "@nyssance/codex-acp-v2/client"
import * as core from "@tauri-apps/api/core"
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { renderTimeline, runningSession } from "../../__tests__/timeline-host"
import { ImageLightbox } from "../../dialogs/image-lightbox"

vi.mock("@tauri-apps/api/core", async (original) => ({ ...(await original<object>()) }))
await initI18n("en")
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
function image(id: string, path: string): ToolItem {
  return {
    id,
    at: 1,
    replayed: false,
    _meta: null,
    kind: "tool",
    name: "view_image",
    title: `View image ${path}`,
    toolKind: "read",
    status: "completed",
    content: [{ type: "content", content: { type: "resource_link", uri: path, name: path.split("/").at(-1)! } }],
    locations: [{ path }],
    rawInput: { path },
    rawOutput: null,
    endedAt: 2
  }
}
test("native image views replace file cards, load outside cwd on demand, and navigate the gallery", async () => {
  const invoke = vi.spyOn(core, "invoke").mockResolvedValue({ kind: "image", data: "aGVsbG8=", mimeType: "image/png" })
  const view = renderTimeline(
    runningSession("image-view", "/work/my project", [
      image("native-a", "/tmp/one.png"),
      image("native-b", "two%20#.png")
    ]),
    <ImageLightbox />
  )
  expect(invoke).not.toHaveBeenCalled()
  expect(view.queryByText("PNG")).toBeNull()
  expect(view.queryByText(/View image/)).toBeNull()
  fireEvent.click(view.getByRole("button", { name: "Viewed 2 images" }))
  await waitFor(() => expect(view.getAllByRole("img")).toHaveLength(2))
  expect(invoke).toHaveBeenCalledWith("chat_preview_file", { path: "/tmp/one.png" })
  expect(invoke).toHaveBeenCalledWith("chat_preview_file", { path: "/work/my project/two%20#.png" })
  fireEvent.click(view.getByRole("button", { name: "one.png" }))
  const dialog = await view.findByRole("dialog")
  expect(within(dialog).getByRole("img").getAttribute("alt")).toBe("one.png")
  expect(within(dialog).getByRole("button", { name: "Previous image" })).toBeDisabled()
  fireEvent.click(within(dialog).getByRole("button", { name: "Next image" }))
  expect(within(dialog).getByRole("img").getAttribute("alt")).toBe("two%20#.png")
  expect(within(dialog).getByRole("button", { name: "Next image" })).toBeDisabled()
  fireEvent.keyDown(dialog, { key: "ArrowLeft" })
  expect(within(dialog).getByRole("img").getAttribute("alt")).toBe("one.png")
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }))
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
})
