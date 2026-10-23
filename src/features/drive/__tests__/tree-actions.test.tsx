import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

const boundary = vi.hoisted(() => ({ request: vi.fn(), writeText: vi.fn(), error: vi.fn() }))
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: boundary.writeText }))
vi.mock("../controller", () => ({ drive: { request: boundary.request } }))
vi.mock("@alwith/module-drive/react", () => ({
  useDrive: () => ({
    snapshot: {
      running: true,
      baseUrl: "https://drive.test",
      webBaseUrl: "https://web.test",
      localRoot: "/drive",
      roots: []
    }
  }),
  isPinned: () => false,
  togglePinned: vi.fn()
}))
vi.mock("@alwith/module-drive/content", () => ({
  resolveDriveRoot: () => ({ root: { canWrite: true } }),
  resolveCondenseScope: () => ({ scopePath: "file.txt" }),
  driveFileDeepLink: () => "alwith://file/42",
  driveFileWebUrl: () => "https://web.test/file/42"
}))
vi.mock("../pinned", () => ({ useDrivePins: () => [], saveDrivePins: vi.fn() }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }))
vi.mock("sonner", () => ({ toast: { error: boundary.error, success: vi.fn() } }))
vi.mock("@/components/ui/context-menu", () => ({
  ContextMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  )
}))
import { DriveTreeActions } from "../tree-actions"

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

for (const [label, url] of [
  ["Copy web link", "https://web.test/file/42"],
  ["Copy desktop link", "alwith-u://file/42"]
]) {
  test(`${label} uses the system clipboard after awaiting a remote id`, async () => {
    boundary.request.mockImplementation(async () => {
      await Promise.resolve()
      return { type: "id", data: "42" }
    })
    boundary.writeText.mockResolvedValue(undefined)
    const browserWrite = vi.fn().mockRejectedValue(new Error("User activation expired"))
    vi.stubGlobal("navigator", { clipboard: { writeText: browserWrite } })
    render(
      <DriveTreeActions
        path="/drive/file.txt"
        isDirectory={false}
        onSharing={vi.fn()}
        onCondense={vi.fn()}
        onMove={vi.fn()}
        onPublish={vi.fn()}
        saveDocument={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText(label!))
    await waitFor(() => expect(boundary.writeText).toHaveBeenCalledWith(url))
    expect(browserWrite).not.toHaveBeenCalled()
  })
}

test("a system clipboard failure is shown to the user", async () => {
  boundary.request.mockResolvedValue({ type: "id", data: "42" })
  boundary.writeText.mockRejectedValue(new Error("Clipboard unavailable"))
  render(
    <DriveTreeActions
      path="/drive/file.txt"
      isDirectory={false}
      onSharing={vi.fn()}
      onCondense={vi.fn()}
      onMove={vi.fn()}
      onPublish={vi.fn()}
      saveDocument={vi.fn()}
    />
  )
  fireEvent.click(screen.getByText("Copy web link"))
  await waitFor(() => expect(boundary.error).toHaveBeenCalledWith("Error: Clipboard unavailable"))
})

test("publishing retains the cloud placeholder path until confirmation", () => {
  const publish = vi.fn()
  render(
    <DriveTreeActions
      path="/drive/file.txt.yupcloud"
      isDirectory={false}
      onSharing={vi.fn()}
      onCondense={vi.fn()}
      onMove={vi.fn()}
      onPublish={publish}
      saveDocument={vi.fn()}
    />
  )
  fireEvent.click(screen.getByText("Publish to…"))
  expect(publish).toHaveBeenCalledWith("/drive/file.txt.yupcloud", "file")
})
