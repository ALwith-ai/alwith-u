import { afterEach, expect, vi, test } from "vitest"
import { createSession, addPrompt, type ToolItem } from "@alwith/api"
import * as core from "@tauri-apps/api/core"
import * as opener from "@tauri-apps/plugin-opener"
import { fireEvent, render, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { ThemeProvider } from "@/components/theme-provider"
import { initI18n } from "@/lib/i18n"
import { ChatDirectoryContext } from "../../file-actions"
import { formatMentionUri } from "../../composer/mention-uri"
import { ImageLightbox } from "../../dialogs/image-lightbox"
import { ActivityGroup } from "../activity-group"
import { ResourceContent } from "../resource-content"
import { UserMessage } from "../user-message"

vi.mock("@tauri-apps/api/core", async importOriginal => ({ ...(await importOriginal<object>()) }))

vi.mock("@tauri-apps/plugin-opener", async importOriginal => ({ ...(await importOriginal<object>()) }))

await initI18n("en")
const mocks: Array<{ mockRestore(): void }> = []
afterEach(() => {
  for (const mock of mocks.splice(0)) mock.mockRestore()
})

const blob = {
  type: "resource" as const,
  resource: { uri: "file:///tmp/photo.png", mimeType: "image/png", blob: "aGVsbG8=" }
}

test("file references preserve encoded names, bare line locations and reserved filename characters", async () => {
  const path = vi.spyOn(opener, "openPath").mockResolvedValue()
  mocks.push(path)
  const refs = [
    "README.md:12",
    "100%.pdf",
    "reports/report%20one.pdf",
    "reports/%E6%8A%A5%E5%91%8A.pdf",
    formatMentionUri({ kind: "file", absPath: "/tmp/a#b?c.pdf" })
  ]
  const view = render(
    <ChatDirectoryContext value="/tmp/project%20">
      {refs.map(uri => (
        <ResourceContent key={uri} block={{ type: "resource_link", uri, name: uri }} />
      ))}
    </ChatDirectoryContext>
  )
  for (const uri of refs) fireEvent.click(view.getByRole("button", { name: uri }))
  await waitFor(() =>
    expect(path.mock.calls).toEqual([
      ["/tmp/project%20/README.md"],
      ["/tmp/project%20/100%.pdf"],
      ["/tmp/project%20/reports/report one.pdf"],
      ["/tmp/project%20/reports/报告.pdf"],
      ["/tmp/a#b?c.pdf"]
    ])
  )
})

test("download passes the exact payload to the native save dialog and reports failure", async () => {
  const invoke = vi.spyOn(core, "invoke").mockResolvedValue(false)
  const error = vi.spyOn(toast, "error").mockImplementation(() => "error")
  mocks.push(invoke, error)
  const view = render(<ResourceContent block={blob} />)
  const button = view.getByRole("button", { name: "Download photo.png" })
  fireEvent.click(button)
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("chat_save_file", { name: "photo.png", data: "aGVsbG8=" }))
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
  expect(error).not.toHaveBeenCalled()
  invoke.mockRejectedValue(new Error("Disk full"))
  fireEvent.click(button)
  await waitFor(() => expect(error).toHaveBeenCalledWith("Disk full"))
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
})

test("Blob images open the lightbox and undecodable images retain the download action", async () => {
  const view = render(
    <>
      <ResourceContent block={blob} />
      <ImageLightbox />
    </>
  )
  fireEvent.click(view.getByRole("button", { name: "View image" }))
  expect(view.getByRole("dialog").querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=")
  fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" })
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
  fireEvent.error(view.container.querySelector("img") as HTMLImageElement)
  expect(view.queryByRole("button", { name: "View image" })).toBeNull()
  expect(view.getByRole("button", { name: "Download photo.png" })).toBeDefined()
})

test("user references are clickable and resolve against their own thread directory", async () => {
  const path = vi.spyOn(opener, "openPath").mockResolvedValue()
  const error = vi.spyOn(toast, "error").mockImplementation(() => "error")
  mocks.push(path, error)
  const session = addPrompt(
    createSession("owner", "/tmp/owner"),
    [{ type: "resource_link", uri: "reports/result.pdf", name: "result.pdf" }, blob],
    "prompt"
  )
  const item = session.items.find(item => item.kind === "user")
  if (item?.kind !== "user") throw new Error("User prompt is missing")
  const view = render(
    <ChatDirectoryContext value={session.cwd}>
      <UserMessage item={item} />
    </ChatDirectoryContext>
  )
  fireEvent.click(view.getByRole("button", { name: "result.pdf" }))
  await waitFor(() => expect(path).toHaveBeenCalledWith("/tmp/owner/reports/result.pdf"))
  expect(view.container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=")
  path.mockRejectedValue(new Error("File missing"))
  fireEvent.click(view.getByRole("button", { name: "result.pdf" }))
  await waitFor(() => expect(error).toHaveBeenCalledWith("File missing"))
})

test("tool resources expose Blob previews, file links and downloads", async () => {
  const path = vi.spyOn(opener, "openPath").mockResolvedValue()
  mocks.push(path)
  const item: ToolItem = {
    id: "files",
    at: 1,
    replayed: false,
    _meta: null,
    kind: "tool",
    name: "export",
    title: "Export files",
    toolKind: "other",
    status: "completed",
    locations: [],
    rawInput: {},
    rawOutput: null,
    endedAt: 2,
    content: [
      { type: "content", content: blob },
      { type: "content", content: { type: "resource_link", uri: "file:///tmp/report.pdf", name: "report.pdf" } },
      {
        type: "content",
        content: {
          type: "resource",
          resource: { uri: "file:///tmp/movie.mp4", mimeType: "video/mp4", blob: "aGVsbG8=" }
        }
      }
    ]
  }
  const view = render(
    <ThemeProvider>
      <ActivityGroup items={[item]} terminals={{}} streaming={false} />
    </ThemeProvider>
  )
  expect(view.getByRole("button", { name: "Download photo.png" })).toBeDefined()
  expect(view.getByRole("button", { name: "Download movie.mp4" })).toBeDefined()
  expect(view.container.querySelector("video")).toBeNull()
  fireEvent.click(view.getByRole("button", { name: "report.pdf" }))
  await waitFor(() => expect(path).toHaveBeenCalledWith("/tmp/report.pdf"))
})
