import {
  createDriveController,
  type DriveRequest,
  type DriveResponse,
  type RootInfo,
  type Snapshot
} from "@alwith/module-drive"
import { DrivePanel, DriveSharing } from "@alwith/module-drive/react"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { driveControls } from "@/features/drive/controls"

afterEach(cleanup)
const root: RootInfo = {
  projectId: "one",
  projectKey: "one",
  name: "Project One",
  kind: "MATERIAL",
  scope: "PERSONAL",
  deptName: null,
  drivePath: "One",
  node: null,
  container: null,
  nodePath: null,
  skillsPath: null,
  syncEnabled: true,
  canWrite: true,
  cloudOnly: false,
  cursor: null,
  pinned: false,
  departmentId: null,
  ownerId: null,
  isMine: true,
  localPath: "/drive/One",
  selected: true
}
function snapshot(configured = true): Snapshot {
  return {
    version: 1,
    generation: 1,
    sequence: 0,
    configured,
    running: configured,
    baseUrl: "https://drive.example.com",
    localRoot: "/drive",
    webBaseUrl: null,
    status: null,
    roots: configured ? [root] : [],
    files: [],
    projects: [],
    pendingDeletes: [],
    error: null
  }
}
async function fixture(state: Snapshot, handle: (request: DriveRequest) => Promise<DriveResponse>) {
  const requests: DriveRequest[] = []
  const controller = createDriveController({
    subscribe: async () => () => {},
    request: async request => {
      requests.push(request)
      if (request.type === "snapshot") return { type: "snapshot", data: { ...state } }
      if (request.type === "ownershipGuard")
        return {
          type: "ownershipGuard",
          data: { unknownPersonalRoots: 0, threshold: 10, syncAllPersonal: false, active: false }
        }
      if (request.type === "shared") return { type: "shared", data: [] }
      if (request.type === "failedUploads") return { type: "failedUploads", data: [] }
      if (request.type === "configuration")
        return {
          type: "configuration",
          data: { deviceId: "device-1", userName: "Test", userId: "1", clientConfig: null }
        }
      if (request.type === "skillMirrors") return { type: "skillMirrors", data: [] }
      return handle(request)
    }
  })
  await controller.attach()
  return { controller, requests }
}

test("sign-in registers the supplied token and starts only after registration", async () => {
  const state = snapshot(false)
  const { controller, requests } = await fixture(state, async request => {
    if (request.type === "ssoConfig") return { type: "ssoConfig", data: { enabled: false } }
    if (request.type === "maxAutoDownloadMb") return { type: "maxAutoDownloadMb", data: 100 }
    if (request.type === "login") {
      state.configured = true
      return { type: "snapshot", data: { ...state } }
    }
    if (request.type === "start") {
      state.running = true
      return { type: "snapshot", data: { ...state } }
    }
    throw new Error("Unexpected request")
  })
  render(
    <DrivePanel controller={controller} controls={driveControls} onOpenProject={vi.fn()} confirm={async () => false} />
  )
  fireEvent.change(screen.getByLabelText("Server address"), { target: { value: "https://drive.example.com" } })
  fireEvent.change(screen.getByLabelText("Personal access token"), { target: { value: "private-token" } })
  fireEvent.click(screen.getByRole("button", { name: "Register this device" }))
  await waitFor(() =>
    expect(
      requests.filter(
        request =>
          ![
            "snapshot",
            "ownershipGuard",
            "shared",
            "failedUploads",
            "configuration",
            "skillMirrors",
            "maxAutoDownloadMb",
            "ssoConfig"
          ].includes(request.type)
      )
    ).toEqual([
      { type: "login", baseUrl: "https://drive.example.com", localRoot: "/drive", token: "private-token" },
      { type: "start" }
    ])
  )
  expect(screen.queryByLabelText("Personal access token")).not.toBeInTheDocument()
  controller.dispose()
})

test("project navigation waits for a native landing result", async () => {
  let land!: (response: DriveResponse) => void
  const { controller } = await fixture(snapshot(), request => {
    if (request.type === "land")
      return new Promise(resolve => {
        land = resolve
      })
    throw new Error("Unexpected request")
  })
  const open = vi.fn(async () => {})
  render(
    <DrivePanel
      controller={controller}
      controls={driveControls}
      mode="launcher"
      onOpenProject={open}
      confirm={async () => false}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "Project One" }))
  expect(open).not.toHaveBeenCalled()
  await act(async () => land({ type: "root", data: root }))
  expect(open).toHaveBeenCalledWith(root)
  controller.dispose()
})

test("declining a cloud deletion never submits the decision", async () => {
  const state = snapshot()
  state.pendingDeletes = [{ projectId: "one", drivePath: "One", count: 12 }]
  const { controller, requests } = await fixture(state, async () => {
    throw new Error("Must not mutate")
  })
  const confirm = vi.fn(async () => false)
  render(
    <DrivePanel
      controller={controller}
      controls={driveControls}
      mode="status"
      onOpenProject={vi.fn()}
      confirm={confirm}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "Delete from cloud" }))
  await waitFor(() => expect(screen.getByRole("button", { name: "Delete from cloud" })).not.toBeDisabled())
  expect(confirm).toHaveBeenCalledOnce()
  expect(requests.every(request => request.type === "snapshot" || request.type === "failedUploads")).toBe(true)
  controller.dispose()
})

test("read-only sharing exposes access requests without administrative controls", async () => {
  const { controller, requests } = await fixture(snapshot(), async request => {
    if (request.type === "grantTarget") return { type: "grantTarget", data: { kind: "FILE", id: "file-1" } }
    if (request.type === "grants") return { type: "grants", data: { callerLevel: "VIEW", grants: [], implicit: [] } }
    if (request.type === "requestAccess") return { type: "accessRequest", data: "submitted" }
    throw new Error("Unexpected request")
  })
  render(
    <DriveSharing
      controller={controller}
      controls={driveControls}
      path="/drive/One/note.md"
      confirm={async () => false}
    />
  )
  await waitFor(() => expect(screen.getByRole("button", { name: "Request access" })).not.toBeDisabled())
  expect(screen.queryByRole("heading", { name: "Add collaborator" })).not.toBeInTheDocument()
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Request access" }))
  await screen.findByText("Request submitted — you'll be notified once it's approved")
  expect(requests).toContainEqual({
    type: "requestAccess",
    requestType: "FILE_ACCESS",
    targetId: "file-1",
    message: null
  })
  controller.dispose()
})

test("launcher sends unconfigured users to settings without showing credentials", async () => {
  const { controller } = await fixture(snapshot(false), async () => ({ type: "done" }))
  const onOpenSettings = vi.fn()
  render(
    <DrivePanel
      controller={controller}
      controls={driveControls}
      onOpenProject={vi.fn()}
      confirm={async () => false}
      mode="launcher"
      onOpenSettings={onOpenSettings}
    />
  )
  expect(screen.queryByLabelText("Personal access token")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Sign in to YUP Drive" }))
  expect(onOpenSettings).toHaveBeenCalledOnce()
  controller.dispose()
})

test("launcher exposes project navigation without inline sync-selection controls", async () => {
  const { controller } = await fixture(snapshot(), async () => ({ type: "root", data: root }))
  render(
    <DrivePanel
      controller={controller}
      controls={driveControls}
      onOpenProject={vi.fn()}
      confirm={async () => false}
      mode="launcher"
    />
  )
  expect(screen.getByRole("button", { name: "Project One" })).toBeInTheDocument()
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  expect(screen.queryByRole("switch")).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Sync now" })).not.toBeInTheDocument()
  controller.dispose()
})

test("settings use the host default server and hide SSO when disabled", async () => {
  const state = { ...snapshot(false), baseUrl: "" }
  const { controller, requests } = await fixture(state, async request => {
    if (request.type === "ssoConfig") return { type: "ssoConfig", data: { enabled: false } }
    if (request.type === "login") {
      state.configured = true
      return { type: "snapshot", data: { ...state } }
    }
    if (request.type === "start") return { type: "snapshot", data: { ...state, running: true } }
    if (request.type === "maxAutoDownloadMb") return { type: "maxAutoDownloadMb", data: 100 }
    throw new Error(`Unexpected request: ${request.type}`)
  })
  render(
    <DrivePanel
      controller={controller}
      controls={driveControls}
      mode="settings"
      defaultBaseUrl="https://drive.example.com"
      onOpenProject={vi.fn()}
      confirm={async () => false}
    />
  )
  await waitFor(() => expect(requests).toContainEqual({ type: "ssoConfig", baseUrl: "https://drive.example.com" }))
  expect(screen.queryByRole("button", { name: "SSO sign in" })).not.toBeInTheDocument()
  expect(screen.getByText("Advanced (server addresses)").parentElement).not.toHaveAttribute("open")
  fireEvent.change(screen.getByLabelText("Personal access token"), { target: { value: "private-token" } })
  fireEvent.click(screen.getByRole("button", { name: "Register this device" }))
  await waitFor(() =>
    expect(requests).toContainEqual({
      type: "login",
      baseUrl: "https://drive.example.com",
      token: "private-token",
      localRoot: "/drive"
    })
  )
  expect(screen.queryByRole("button", { name: "Project One" })).not.toBeInTheDocument()
  controller.dispose()
})

test("download settings reject fractional limits and preserve zero as unlimited", async () => {
  const { controller, requests } = await fixture(snapshot(), async request => {
    if (request.type === "maxAutoDownloadMb") return { type: "maxAutoDownloadMb", data: 100 }
    if (request.type === "setMaxAutoDownloadMb") return { type: "maxAutoDownloadMb", data: request.megabytes }
    throw new Error(`Unexpected request: ${request.type}`)
  })
  render(
    <DrivePanel
      controller={controller}
      controls={driveControls}
      mode="settings"
      onOpenProject={vi.fn()}
      confirm={async () => false}
    />
  )
  const limit = await screen.findByDisplayValue("100")
  fireEvent.change(limit, { target: { value: "1.5" } })
  fireEvent.blur(limit)
  expect(requests.filter(request => request.type === "setMaxAutoDownloadMb")).toEqual([])
  fireEvent.change(limit, { target: { value: "0" } })
  fireEvent.blur(limit)
  await waitFor(() => expect(requests).toContainEqual({ type: "setMaxAutoDownloadMb", megabytes: 0 }))
  controller.dispose()
})
