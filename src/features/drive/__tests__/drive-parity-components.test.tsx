import type { DriveController, DriveRequest, DriveResponse, Snapshot } from "@alwith/module-drive"
import { DriveCondense, DriveMoveDialog } from "@alwith/module-drive/content"
import {
  DriveBadge,
  type DriveControls,
  type DriveHost,
  DriveMassDeleteDialog,
  DriveNotificationProvider,
  DrivePanel
} from "@alwith/module-drive/react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { expect, test, vi } from "vitest"

import { driveControls } from "../controls"

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
): { controller: DriveController; requests: DriveRequest[]; update: (patch: Partial<Snapshot>) => void } {
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
  let state = { connected: true, snapshot, error: null }
  const listeners = new Set<() => void>()
  const requests: DriveRequest[] = []
  return {
    requests,
    update: patch => {
      state = { ...state, snapshot: { ...state.snapshot, ...patch } }
      listeners.forEach(listener => {
        listener()
      })
    },
    controller: {
      subscribe: listener => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
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

test("status panel uses a state row and disables the sync icon while paused", async () => {
  const f = fixture({
    status: {
      state: { kind: "paused" },
      pending: 0,
      uploading: 0,
      downloading: 0,
      synced: 1,
      failed: 0,
      conflicts: [],
      errors: [],
      lastSyncAt: null,
      pushConnected: false
    }
  })
  render(
    <DrivePanel {...f} controls={controls} mode="status" onOpenProject={async () => {}} confirm={async () => true} />
  )
  expect(screen.getByText("State").tagName).toBe("DT")
  expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled()
  expect(screen.queryByRole("button", { name: "Re-check" })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Resume" }))
  await waitFor(() => expect(f.requests).toContainEqual({ type: "pause", paused: false }))
})

test("status panel exposes conflicts immediately and keeps re-check available for errors", async () => {
  const reveal = vi.fn(async (_path: string) => {})
  const f = fixture({
    status: {
      state: { kind: "error", message: "Sync unavailable" },
      pending: 0,
      uploading: 0,
      downloading: 0,
      synced: 1,
      failed: 0,
      conflicts: [
        {
          projectId: 1,
          path: "report.md",
          localPath: "/drive/report.md",
          conflictCopyPath: "/drive/report.conflict.md",
          remoteUpdatedBy: null,
          at: "2026-10-12T06:00:00Z"
        }
      ],
      errors: [],
      lastSyncAt: null,
      pushConnected: false
    }
  })
  const host: DriveHost = {
    readDirectory: async () => [],
    pathExists: async () => true,
    onOpenEntry: async () => {},
    onRevealPath: reveal,
    onOpenExternal: async () => {},
    pinnedDocs: [],
    onPinnedDocsChange: async () => {}
  }
  render(
    <DrivePanel
      {...f}
      host={host}
      controls={controls}
      mode="status"
      onOpenProject={async () => {}}
      confirm={async () => true}
    />
  )
  expect(screen.getByText("Sync unavailable", { exact: false })).toBeVisible()
  expect(screen.getByText("report.md", { exact: false })).toBeVisible()
  fireEvent.click(screen.getByRole("button", { name: "Reveal" }))
  await waitFor(() => expect(reveal).toHaveBeenCalledWith("/drive/report.conflict.md"))
  fireEvent.click(screen.getByRole("button", { name: "Re-check" }))
  await waitFor(() => expect(f.requests).toContainEqual({ type: "reconcile", projectId: null }))
})

test("condense dialog separates its scope from the title and groups actions in the footer", async () => {
  const f = fixture({}, async request => {
    if (request.type === "proposedCondense") return { type: "jobs", data: [] }
    throw new Error(`Unexpected request ${request.type}`)
  })
  const onClose = vi.fn()
  render(
    <DriveCondense
      controller={f.controller}
      scope={{ projectId: 1, projectName: "admin的个人知识库", scopePath: null }}
      controls={driveControls}
      locale="zh-CN"
      onClose={onClose}
      onOpenFile={async () => {}}
      onOpenExternal={async () => {}}
    />
  )
  await act(async () => {})
  expect(screen.getByText("沉淀范围")).toBeInTheDocument()
  expect(screen.getByText("admin的个人知识库")).toBeInTheDocument()
  expect(screen.queryByRole("heading", { name: /沉淀为知识/ })).not.toBeInTheDocument()
  const close = screen.getByRole("button", { name: "关闭" })
  const condense = screen.getByRole("button", { name: "沉淀为知识" })
  expect(close.parentElement).toHaveClass("alwith-drive-dialog-actions")
  expect(close.nextElementSibling).toBe(condense)
  expect(close).toHaveClass("bg-background")
  expect(condense).toHaveClass("bg-primary")
  fireEvent.click(close)
  expect(onClose).toHaveBeenCalledOnce()
  expect(f.requests).toEqual([{ type: "proposedCondense", projectId: 1 }])
})

test("condense preflight keeps the safe exit before proceeding with missing uploads", async () => {
  const f = fixture({ running: true }, async request => {
    if (request.type === "proposedCondense") return { type: "jobs", data: [] }
    if (request.type === "condensePreflight")
      return { type: "unsynced", data: { pending: 1, failed: 1, paths: ["report.md"] } }
    throw new Error(`Unexpected request ${request.type}`)
  })
  const onClose = vi.fn()
  render(
    <DriveCondense
      controller={f.controller}
      scope={{ projectId: 1, projectName: "Reports", scopePath: null }}
      controls={driveControls}
      locale="zh-CN"
      onClose={onClose}
      onOpenFile={async () => {}}
      onOpenExternal={async () => {}}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "沉淀为知识" }))
  expect(await screen.findByText("report.md")).toBeInTheDocument()
  const wait = screen.getByRole("button", { name: "先等等" })
  const proceed = screen.getByRole("button", { name: "仍然沉淀" })
  expect(wait.nextElementSibling).toBe(proceed)
  expect(wait.parentElement).toHaveClass("alwith-drive-dialog-actions")
  expect(wait).toHaveClass("bg-background")
  expect(proceed).toHaveClass("bg-primary")
  fireEvent.click(wait)
  expect(onClose).toHaveBeenCalledOnce()
  expect(f.requests).not.toContainEqual({ type: "condenseStart", projectId: 1, scopePath: null })
})

test("move dialog groups the secondary cancel action before the primary move action", () => {
  const f = fixture()
  const onClose = vi.fn()
  render(
    <DriveMoveDialog
      path="/drive/report.md"
      kind="file"
      controller={f.controller}
      controls={driveControls}
      locale="zh-CN"
      host={{ confirm: async () => true, prepareMove: async () => true, onMoved: async () => {} }}
      onClose={onClose}
    />
  )
  const cancel = screen.getByRole("button", { name: "取消" })
  const move = screen.getByRole("button", { name: "移动" })
  expect(cancel.parentElement).toHaveClass("alwith-drive-dialog-actions")
  expect(cancel.nextElementSibling).toBe(move)
  expect(cancel).toHaveClass("bg-background")
  expect(move).toHaveClass("bg-primary")
  expect(move).toBeDisabled()
  fireEvent.click(cancel)
  expect(onClose).toHaveBeenCalledOnce()
  expect(f.requests).toEqual([])
})

async function settingsResponse(request: DriveRequest): Promise<DriveResponse> {
  switch (request.type) {
    case "maxAutoDownloadMb":
      return { type: "maxAutoDownloadMb", data: 20 }
    case "configuration":
      return { type: "configuration", data: { deviceId: "device", userName: "Test", userId: "1", clientConfig: null } }
    case "ownershipGuard":
      return {
        type: "ownershipGuard",
        data: { unknownPersonalRoots: 0, threshold: 10, syncAllPersonal: false, active: false }
      }
    case "skillMirrors":
      return { type: "skillMirrors", data: [] }
    default:
      throw new Error(`Unexpected request ${request.type}`)
  }
}

test.each(["device", null])(
  "settings distinguish pending device information from registration (%s)",
  async deviceId => {
    let resolveConfiguration!: (response: DriveResponse) => void
    const configuration = new Promise<DriveResponse>(resolve => {
      resolveConfiguration = resolve
    })
    const f = fixture({ configured: false, running: false }, request =>
      request.type === "configuration" ? configuration : settingsResponse(request)
    )
    render(
      <DrivePanel
        {...f}
        locale="zh-CN"
        controls={controls}
        mode="settings"
        onOpenProject={async () => {}}
        confirm={async () => true}
      />
    )
    await act(async () => f.update({ configured: true, generation: 2 }))
    expect(screen.getByText("已登录 · 正在读取设备信息…")).toBeInTheDocument()
    expect(screen.queryByText("已登录 · 设备未注册")).not.toBeInTheDocument()
    await act(async () => {
      resolveConfiguration({
        type: "configuration",
        data: { deviceId, userName: "Test", userId: "1", clientConfig: null }
      })
    })
    expect(screen.getByText(deviceId ? "已登录 · 设备 device" : "已登录 · 设备未注册")).toBeInTheDocument()
    expect(screen.queryByText("已登录 · 正在读取设备信息…")).not.toBeInTheDocument()
  }
)

test("failed device information loading never claims the device is unregistered", async () => {
  const f = fixture({ running: false }, async request => {
    if (request.type === "configuration") throw new Error("Cannot read configuration")
    return settingsResponse(request)
  })
  render(
    <DrivePanel
      {...f}
      locale="zh-CN"
      controls={controls}
      mode="settings"
      onOpenProject={async () => {}}
      confirm={async () => true}
    />
  )
  expect(await screen.findByRole("alert")).toHaveTextContent("Cannot read configuration")
  expect(screen.getByText("已登录 · 设备信息读取失败")).toBeInTheDocument()
  expect(screen.queryByText("已登录 · 设备未注册")).not.toBeInTheDocument()
  expect(screen.queryByText("已登录 · 正在读取设备信息…")).not.toBeInTheDocument()
})

test("settings load login preferences before runtime and fetch runtime data when it starts", async () => {
  const f = fixture({ running: false }, settingsResponse)
  render(
    <DrivePanel {...f} controls={controls} mode="settings" onOpenProject={async () => {}} confirm={async () => true} />
  )
  await screen.findByText(/device/)
  expect(f.requests).toContainEqual({ type: "maxAutoDownloadMb" })
  expect(f.requests).not.toContainEqual({ type: "ownershipGuard" })
  expect(f.requests).not.toContainEqual({ type: "skillMirrors" })
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  await act(async () => f.update({ running: true }))
  await waitFor(() => expect(f.requests).toContainEqual({ type: "skillMirrors" }))
  expect(f.requests).toContainEqual({ type: "ownershipGuard" })
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})

test("settings clear a runtime load error after a successful restart", async () => {
  let failed = true
  const f = fixture({}, async request => {
    if (failed && request.type === "skillMirrors") throw new Error("Drive is not running")
    return settingsResponse(request)
  })
  render(
    <DrivePanel {...f} controls={controls} mode="settings" onOpenProject={async () => {}} confirm={async () => true} />
  )
  expect(await screen.findByRole("alert")).toHaveTextContent("Drive is not running")
  failed = false
  await act(async () => f.update({ generation: 2 }))
  await screen.findByText(/device/)
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
})

test("successful runtime loading does not clear a configuration failure", async () => {
  const f = fixture({ running: false }, async request => {
    if (request.type === "configuration") throw new Error("Cannot read configuration")
    return settingsResponse(request)
  })
  render(
    <DrivePanel {...f} controls={controls} mode="settings" onOpenProject={async () => {}} confirm={async () => true} />
  )
  expect(await screen.findByRole("alert")).toHaveTextContent("Cannot read configuration")
  await act(async () => f.update({ running: true }))
  await waitFor(() => expect(f.requests).toContainEqual({ type: "skillMirrors" }))
  expect(screen.getByRole("alert")).toHaveTextContent("Cannot read configuration")
})

test.each([
  [false, "login"],
  [true, "login"],
  [false, "ssoLogin"],
  [true, "ssoLogin"]
] as const)("directory adoption requires explicit confirmation (%s, %s)", async (accept, method) => {
  const f = fixture({ configured: false, running: false }, async request => {
    if (request.type === "ssoConfig") return { type: "ssoConfig", data: { enabled: true } }
    if (request.type === method)
      return { type: "rootOwnershipConfirmation", data: { generation: 2, localRoot: "/drive" } }
    return { type: "done" }
  })
  render(
    <DrivePanel
      {...f}
      locale="zh-CN"
      controls={controls}
      mode="settings"
      onOpenProject={async () => {}}
      confirm={async () => true}
    />
  )
  if (method === "login") {
    fireEvent.change(screen.getByPlaceholderText("个人访问令牌"), { target: { value: "test-token" } })
    fireEvent.click(screen.getByRole("button", { name: "注册此设备" }))
  } else {
    fireEvent.click(await screen.findByRole("button", { name: "SSO 登录" }))
  }
  const dialog = await screen.findByRole("dialog", { name: "继续使用该目录？" })
  expect(dialog).toHaveTextContent("可能上传到当前账号")
  expect(f.requests).not.toContainEqual({ type: "start" })
  fireEvent.click(screen.getByRole("button", { name: accept ? "继续" : "取消" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  expect(f.requests).toContainEqual({ type: "resolveRootOwnership", generation: 2, accept })
  expect(f.requests.filter(request => request.type === method)).toHaveLength(1)
  expect(f.requests.some(request => request.type === "start")).toBe(accept)
})

test("condense shows only the current project upload and resumes after closing", async () => {
  let settle!: (response: DriveResponse) => void
  const f = fixture({}, async request => {
    if (request.type === "proposedCondense") return { type: "jobs", data: [] }
    if (request.type === "condensePreflight")
      return new Promise(resolve => {
        settle = resolve
      })
    if (request.type === "condenseStart") return { type: "job", data: { id: 7, status: "RUNNING" } }
    throw new Error(`Unexpected request ${request.type}`)
  })
  const props = {
    controller: f.controller,
    scope: { projectId: 1, projectName: "Reports", scopePath: null },
    controls,
    locale: "zh-CN" as const,
    onClose: vi.fn(),
    onOpenFile: async () => {},
    onOpenExternal: async () => {}
  }
  const view = render(<DriveCondense {...props} />)
  fireEvent.click(screen.getByRole("button", { name: "沉淀为知识" }))
  act(() =>
    f.update({
      files: [
        { projectId: 2, path: "other.md", localPath: "/drive/other.md", state: "uploading" },
        { projectId: 1, path: "current.md", localPath: "/drive/current.md", state: "uploading" }
      ]
    })
  )
  expect(screen.getByText("current.md")).toBeInTheDocument()
  expect(screen.queryByText("other.md")).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "取消任务" })).toBeEnabled()
  fireEvent.click(screen.getByRole("button", { name: "关闭" }))
  view.unmount()
  await act(async () => settle({ type: "unsynced", data: { pending: 0, failed: 0, paths: [] } }))
  render(<DriveCondense {...props} />)
  expect(screen.getByRole("button", { name: "取消任务" })).toBeEnabled()
  expect(screen.queryByRole("button", { name: "沉淀为知识" })).not.toBeInTheDocument()
  expect(f.requests.filter(request => request.type === "condenseStart")).toHaveLength(1)
  act(() => f.update({ generation: 2 }))
})

test("cancelling during upload prevents job creation after the upload finishes", async () => {
  let settle!: (response: DriveResponse) => void
  const f = fixture({}, async request => {
    if (request.type === "proposedCondense") return { type: "jobs", data: [] }
    if (request.type === "condensePreflight")
      return new Promise(resolve => {
        settle = resolve
      })
    throw new Error(`Unexpected request ${request.type}`)
  })
  render(
    <DriveCondense
      controller={f.controller}
      scope={{ projectId: 1, projectName: "Reports", scopePath: null }}
      controls={controls}
      locale="zh-CN"
      onClose={() => {}}
      onOpenFile={async () => {}}
      onOpenExternal={async () => {}}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "沉淀为知识" }))
  fireEvent.click(screen.getByRole("button", { name: "取消任务" }))
  expect(screen.queryByText("已取消")).not.toBeInTheDocument()
  await act(async () => settle({ type: "unsynced", data: { pending: 0, failed: 0, paths: [] } }))
  expect(screen.getByText("已取消")).toBeInTheDocument()
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  expect(f.requests.some(request => request.type === "condenseStart")).toBe(false)
})

test("cancel acknowledgement is not completion and terminal cancellation is not a failure", async () => {
  vi.useFakeTimers()
  try {
    let status: "RUNNING" | "CANCELLED" = "RUNNING"
    const f = fixture({}, async request => {
      if (request.type === "proposedCondense") return { type: "jobs", data: [] }
      if (request.type === "cancelJob") return { type: "done" }
      if (request.type === "job") return { type: "job", data: { id: 7, status } }
      throw new Error(`Unexpected request ${request.type}`)
    })
    render(
      <DriveCondense
        controller={f.controller}
        scope={{ projectId: 1, projectName: "Reports", scopePath: null }}
        initialJob={{ id: 7, status: "RUNNING" }}
        controls={controls}
        locale="zh-CN"
        onClose={() => {}}
        onOpenFile={async () => {}}
        onOpenExternal={async () => {}}
      />
    )
    await act(async () => {})
    fireEvent.click(screen.getByRole("button", { name: "取消任务" }))
    await act(async () => {})
    expect(screen.queryByText("已取消")).not.toBeInTheDocument()
    status = "CANCELLED"
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(screen.getByText("已取消")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

test("launcher keeps synchronization errors out of navigation while status retains them", async () => {
  const f = fixture({ error: "Conflict: /drive/report.md" })
  const props = { controller: f.controller, controls, onOpenProject: async () => {}, confirm: async () => true }
  const notify = { error: vi.fn(), success: vi.fn() }
  const view = render(
    <DriveNotificationProvider notify={notify}>
      <DrivePanel {...props} mode="launcher" />
    </DriveNotificationProvider>
  )
  await act(async () => {})
  expect(screen.queryByText("Conflict: /drive/report.md")).not.toBeInTheDocument()
  expect(notify.error).toHaveBeenCalledWith("Conflict: /drive/report.md")
  view.rerender(<DrivePanel {...props} mode="status" />)
  expect(screen.getByText("Conflict: /drive/report.md")).toBeInTheDocument()
})

test("a conflict during preflight stays in the dialog and does not include another project", async () => {
  let settle!: (response: DriveResponse) => void
  const f = fixture({}, async request => {
    if (request.type === "proposedCondense") return { type: "jobs", data: [] }
    if (request.type === "condensePreflight")
      return new Promise(resolve => {
        settle = resolve
      })
    if (request.type === "condenseStart") return { type: "job", data: { id: 7, status: "RUNNING" } }
    throw new Error(`Unexpected request ${request.type}`)
  })
  render(
    <DriveCondense
      controller={f.controller}
      scope={{ projectId: 1, projectName: "Reports", scopePath: null }}
      controls={controls}
      locale="zh-CN"
      onClose={() => {}}
      onOpenFile={async () => {}}
      onOpenExternal={async () => {}}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "沉淀为知识" }))
  act(() =>
    f.update({
      files: [
        { projectId: 1, path: "conflicted.md", localPath: "/drive/conflicted.md", state: "conflict" },
        { projectId: 2, path: "unrelated.md", localPath: "/drive/unrelated.md", state: "conflict" }
      ]
    })
  )
  expect(screen.getByRole("alert")).toHaveTextContent("conflicted.md")
  expect(screen.queryByText("unrelated.md")).not.toBeInTheDocument()
  await act(async () => settle({ type: "unsynced", data: { pending: 0, failed: 0, paths: [] } }))
  expect(screen.getByRole("alert")).toHaveTextContent("conflicted.md")
  act(() => f.update({ generation: 2 }))
})

test("a closed condense task finishes once and reopening preserves its result", async () => {
  vi.useFakeTimers()
  try {
    const f = fixture({}, async request => {
      if (request.type === "proposedCondense") return { type: "jobs", data: [] }
      if (request.type === "job")
        return {
          type: "job",
          data: {
            id: 7,
            status: "SUCCEEDED",
            result: { knowledgeFileId: 9, knowledgeTitle: "Draft", humanUrl: "https://drive.test/draft" }
          }
        }
      if (request.type === "localPath") return { type: "path", data: "/drive/draft.md" }
      throw new Error(`Unexpected request ${request.type}`)
    })
    const notify = { error: vi.fn(), success: vi.fn() }
    const open = vi.fn(async () => {})
    const props = {
      controller: f.controller,
      scope: { projectId: 1, projectName: "Reports", scopePath: null },
      initialJob: { id: 7, status: "RUNNING" as const },
      controls,
      locale: "zh-CN" as const,
      onClose: () => {},
      onOpenFile: open,
      onOpenExternal: async () => {}
    }
    const view = render(
      <DriveNotificationProvider notify={notify}>
        <DriveCondense {...props} />
      </DriveNotificationProvider>
    )
    await act(async () => {})
    view.unmount()
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(notify.success).toHaveBeenCalledOnce()
    expect(open).not.toHaveBeenCalled()
    render(
      <DriveNotificationProvider notify={notify}>
        <DriveCondense {...props} />
      </DriveNotificationProvider>
    )
    await act(async () => {})
    expect(screen.getByText("沉淀成功")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "打开草稿" }))
    await act(async () => {})
    expect(open).toHaveBeenCalledWith("/drive/draft.md")
    expect(notify.success).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
  }
})

test("a rejected knowledge source remains actionable inside the dialog", async () => {
  const f = fixture({}, async request => {
    if (request.type === "proposedCondense") return { type: "jobs", data: [] }
    if (request.type === "condensePreflight") return { type: "unsynced", data: { pending: 0, failed: 0, paths: [] } }
    if (request.type === "condenseStart") throw new Error("HTTP 400: SOURCE_IS_KNOWLEDGE_PROJECT: source is knowledge")
    throw new Error(`Unexpected request ${request.type}`)
  })
  render(
    <DriveCondense
      controller={f.controller}
      scope={{ projectId: 1, projectName: "Knowledge", scopePath: null }}
      controls={controls}
      locale="zh-CN"
      onClose={() => {}}
      onOpenFile={async () => {}}
      onOpenExternal={async () => {}}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "沉淀为知识" }))
  expect(await screen.findByText("沉淀失败")).toBeInTheDocument()
  expect(screen.getByRole("alert")).toHaveTextContent("SOURCE_IS_KNOWLEDGE_PROJECT")
  expect(screen.getByRole("button", { name: "重试" })).toBeEnabled()
})

test("repeated background synchronization errors produce one toast", async () => {
  const f = fixture({ error: "Conflict: report.md" })
  const notify = { error: vi.fn(), success: vi.fn() }
  render(
    <DriveNotificationProvider notify={notify}>
      <DrivePanel
        controller={f.controller}
        controls={controls}
        mode="launcher"
        onOpenProject={async () => {}}
        confirm={async () => true}
      />
    </DriveNotificationProvider>
  )
  await act(async () => {})
  act(() => f.update({ error: null }))
  act(() => f.update({ error: "Conflict: report.md" }))
  expect(notify.error).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})
