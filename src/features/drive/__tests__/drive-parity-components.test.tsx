import type { DriveController, DriveRequest, DriveResponse, Snapshot } from "@alwith/module-drive"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { expect, test, vi } from "vitest"
import {
  DriveBadge,
  type DriveControls,
  type DriveHost,
  DriveMassDeleteDialog,
  DrivePanel
} from "@alwith/module-drive/react"

const controls: DriveControls = {
  Button: ({ variant: _variant, size: _size, ...props }) => <button type="button" {...props} />,
  Input: props => <input {...props} />,
  Dialog: ({ title, description, children, onOpenChange }) => (
    <div role="dialog" aria-label={title}>
      <p>{description}</p>
      {children}
      <button type="button" onClick={() => onOpenChange(false)}>
        Dismiss
      </button>
    </div>
  ),
  Menu: () => null,
  ContextMenu: ({ children, items }) => (
    <>
      {children}
      {items.map(item => (
        <button type="button" key={item.label} onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </>
  ),
  Switch: ({ checked, onCheckedChange, ...props }) => (
    <button type="button" role="switch" aria-checked={checked} {...props} onClick={() => onCheckedChange(!checked)} />
  )
}
function fixture(
  patch: Partial<Snapshot> = {},
  handle?: (request: DriveRequest) => Promise<DriveResponse>
): { controller: DriveController; requests: DriveRequest[] } {
  const snapshot: Snapshot = {
    version: 1,
    generation: 1,
    sequence: 0,
    configured: true,
    running: true,
    baseUrl: "https://drive.test",
    localRoot: "/drive",
    webBaseUrl: null,
    status: null,
    roots: [],
    files: [],
    projects: [],
    pendingDeletes: [],
    error: null,
    ...patch
  }
  const state = { connected: true, snapshot, error: null }
  const requests: DriveRequest[] = []
  return {
    requests,
    controller: {
      subscribe: () => () => {},
      getSnapshot: () => state,
      attach: async () => {},
      refresh: async () => {},
      dispose: () => {},
      request: async request => {
        requests.push(request)
        if (handle) return handle(request)
        if (request.type === "failedUploads") return { type: "failedUploads", data: [] }
        if (request.type === "shared") return { type: "shared", data: [] }
        if (request.type === "ownershipGuard")
          return {
            type: "ownershipGuard",
            data: { unknownPersonalRoots: 0, threshold: 10, syncAllPersonal: false, active: false }
          }
        return { type: "done" }
      }
    }
  }
}
test("sync status exposes its settings action", () => {
  const f = fixture()
  const open = vi.fn()
  render(
    <DrivePanel
      {...f}
      controls={controls}
      mode="status"
      onOpenSettings={open}
      onOpenProject={async () => {}}
      confirm={async () => true}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
  expect(open).toHaveBeenCalledOnce()
})
test("missing pins retain their identity and expose context-menu unpin", async () => {
  const f = fixture()
  const update = vi.fn(async () => {})
  const host: DriveHost = {
    readDirectory: async () => [],
    pathExists: async () => false,
    onOpenEntry: async () => {},
    onRevealPath: async () => {},
    onOpenExternal: async () => {},
    pinnedDocs: [{ path: "/drive/missing.md", name: "Missing", kind: "file" }],
    onPinnedDocsChange: update
  }
  render(
    <DrivePanel
      {...f}
      host={host}
      controls={controls}
      mode="launcher"
      onOpenProject={async () => {}}
      confirm={async () => true}
    />
  )
  const pin = await screen.findByRole("button", { name: "Missing" })
  await waitFor(() => expect(pin).toHaveAttribute("data-missing", "true"))
  fireEvent.click(screen.getByRole("button", { name: "Unpin from sidebar" }))
  await waitFor(() => expect(update).toHaveBeenCalledWith([]))
})
test("file badges translate states and directories prioritize descendant conflicts", () => {
  const f = fixture({
    files: [
      { projectId: 1, path: "a.md", localPath: "/drive/a.md", state: "error" },
      { projectId: 1, path: "b.md", localPath: "/drive/b.md", state: "conflict" }
    ]
  })
  render(
    <>
      <DriveBadge controller={f.controller} path="/drive/a.md" locale="zh-CN" />
      <DriveBadge controller={f.controller} path="/drive" isDirectory locale="en" />
    </>
  )
  expect(screen.getByLabelText("错误")).toBeInTheDocument()
  expect(screen.getByLabelText("Conflict")).toBeInTheDocument()
})
test("mass-delete dismiss restores only the head batch and confirmation sends one command", async () => {
  const f = fixture({
    pendingDeletes: [
      { projectId: 1, drivePath: "First", count: 12 },
      { projectId: 2, drivePath: "Second", count: 24 }
    ]
  })
  const view = render(<DriveMassDeleteDialog {...f} controls={controls} />)
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Delete 12 files from the cloud too?")
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
  await waitFor(() => expect(f.requests).toEqual([{ type: "cancelDeletes", projectId: 1 }]))
  view.unmount()
  const confirmed = fixture({ pendingDeletes: [{ projectId: 2, drivePath: "Second", count: 24 }] })
  render(<DriveMassDeleteDialog {...confirmed} controls={controls} />)
  fireEvent.click(screen.getByRole("button", { name: "Delete from cloud" }))
  await waitFor(() => expect(confirmed.requests).toEqual([{ type: "confirmDeletes", projectId: 2 }]))
})

test("settings use the injected shadcn switch and propagate its checked value", async () => {
  const f = fixture({}, async request => {
    if (request.type === "maxAutoDownloadMb") return { type: "maxAutoDownloadMb", data: 20 }
    if (request.type === "ownershipGuard")
      return {
        type: "ownershipGuard",
        data: { unknownPersonalRoots: 0, threshold: 10, syncAllPersonal: false, active: false }
      }
    if (request.type === "configuration")
      return { type: "configuration", data: { deviceId: "device", userName: "Test", userId: "1", clientConfig: null } }
    if (request.type === "skillMirrors") return { type: "skillMirrors", data: [] }
    if (request.type === "pause") return { type: "done" }
    throw new Error(`Unexpected request ${request.type}`)
  })
  render(
    <DrivePanel {...f} controls={controls} mode="settings" onOpenProject={async () => {}} confirm={async () => true} />
  )
  const toggle = screen.getByRole("switch", { name: "Pause sync" })
  expect(toggle.tagName).toBe("BUTTON")
  fireEvent.click(toggle)
  await waitFor(() => expect(f.requests).toContainEqual({ type: "pause", paused: true }))
})
test("failed mass deletion retains the dialog and never advances to another batch", async () => {
  const f = fixture(
    {
      pendingDeletes: [
        { projectId: 1, drivePath: "First", count: 12 },
        { projectId: 2, drivePath: "Second", count: 24 }
      ]
    },
    async () => {
      throw new Error("Server rejected deletion")
    }
  )
  render(<DriveMassDeleteDialog {...f} controls={controls} />)
  fireEvent.click(screen.getByRole("button", { name: "Delete from cloud" }))
  await screen.findByRole("alert")
  expect(screen.getByRole("alert")).toHaveTextContent("Server rejected deletion")
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Delete 12 files from the cloud too?")
  expect(f.requests).toEqual([{ type: "confirmDeletes", projectId: 1 }])
})
