import {
  CONTRACT_VERSION,
  createDriveController,
  type DriveEvent,
  type DriveRequest,
  type DriveResponse,
  type Snapshot
} from "@alwith/module-drive"
import { DriveBadge, DrivePanel, useDriveSelector } from "@alwith/module-drive/react"
import { act, cleanup, render, screen } from "@testing-library/react"
import { Profiler } from "react"
import { afterEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

const bridge = vi.hoisted(() => ({
  request: vi.fn<(request: DriveRequest) => Promise<DriveResponse>>()
}))
vi.mock("../controller", async () => {
  const { createDriveController } = await import("@alwith/module-drive")
  const transport = { request: bridge.request, subscribe: async () => () => {} }
  return { drive: createDriveController(transport), driveTransport: transport }
})
vi.mock("../use-drive-visible", () => ({ useDriveVisible: () => true }))
vi.mock("@/features/chat/project-session-popover", () => ({ ProjectSessionPopover: () => null }))

import { drive } from "../controller"
import { driveControls } from "../controls"
import { DriveStatus } from "../drive"

const initial = (): Snapshot => ({
  version: CONTRACT_VERSION,
  generation: 1,
  sequence: 0,
  configured: true,
  running: true,
  baseUrl: "https://drive.test",
  localRoot: "/drive",
  webBaseUrl: null,
  roots: [],
  files: [],
  projects: [],
  pendingDeletes: [],
  error: null,
  status: {
    state: { kind: "idle" },
    pending: 0,
    uploading: 0,
    downloading: 0,
    synced: 0,
    failed: 1,
    lastSyncAt: null,
    pushConnected: false,
    conflicts: [],
    errors: []
  }
})

afterEach(() => {
  cleanup()
  drive.dispose()
  vi.useRealTimers()
})

test("failed transfer lookup settles instead of querying again after its own response", async () => {
  await initI18n("en")
  const snapshot = initial()
  bridge.request.mockClear()
  bridge.request.mockImplementation(async (request) => {
    if (request.type === "snapshot") return { type: "snapshot", data: structuredClone(snapshot) }
    if (request.type === "failedUploads") return { type: "failedUploads", data: [] }
    throw new Error(`Unexpected request: ${request.type}`)
  })
  await drive.attach()
  vi.useFakeTimers()
  render(<DriveStatus />)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250)
  })
  expect(bridge.request.mock.calls.filter(([request]) => request.type === "failedUploads")).toHaveLength(1)
})

test("unrelated synchronization events do not render document selectors and badges still recover", async () => {
  let listener!: (event: DriveEvent) => void
  const snapshot = initial()
  const controller = createDriveController({
    request: async () => ({ type: "snapshot", data: snapshot }),
    subscribe: async (receive) => {
      listener = receive
      return () => {}
    }
  })
  await controller.attach()
  let renders = 0
  function Document() {
    renders++
    const running = useDriveSelector(controller, (state) => state.snapshot?.running)
    return <span>{running ? "running" : "stopped"}</span>
  }
  const view = render(
    <>
      <Document />
      <DriveBadge controller={controller} path="/drive/docs" isDirectory locale="en" />
    </>
  )
  const before = renders
  let sequence = 0
  const emit = (event: DriveEvent["payload"]) => {
    listener({ version: CONTRACT_VERSION, generation: 1, sequence: ++sequence, payload: event })
  }
  try {
    act(() => {
      for (let index = 0; index < 100; index++) emit({ type: "status", data: { ...snapshot.status!, synced: index } })
    })
    expect(renders).toBe(before)
    const file = {
      localPath: "/drive/docs/a.md",
      projectId: "one",
      path: "docs/a.md",
      state: "conflict" as const,
      size: 1
    }
    act(() => emit({ type: "file", data: file }))
    expect(screen.getByLabelText("Conflict")).toBeInTheDocument()
    expect(renders).toBe(before)
    act(() => emit({ type: "file", data: { ...file, state: "synced" } }))
    expect(screen.queryByLabelText("Conflict")).not.toBeInTheDocument()
  } finally {
    view.unmount()
    controller.dispose()
  }
})

test("background transfer tracking does not repaint the launcher on every sync event", async () => {
  let listener!: (event: DriveEvent) => void
  const snapshot = initial()
  const controller = createDriveController({
    subscribe: async (receive) => {
      listener = receive
      return () => {}
    },
    request: async (request) => {
      if (request.type === "ownershipGuard")
        return {
          type: "ownershipGuard",
          data: { unknownPersonalRoots: 0, threshold: 10, active: false, syncAllPersonal: false }
        }
      if (request.type === "shared") return { type: "shared", data: [] }
      return { type: "snapshot", data: structuredClone(snapshot) }
    }
  })
  await controller.attach()
  const commits = vi.fn()
  const view = render(
    <Profiler id="launcher" onRender={commits}>
      <DrivePanel
        controller={controller}
        controls={driveControls}
        mode="launcher"
        locale="en"
        onOpenProject={async () => {}}
        confirm={async () => false}
      />
    </Profiler>
  )
  try {
    await act(async () => {})
    const before = commits.mock.calls.length
    act(() => {
      for (let sequence = 1; sequence <= 100; sequence++)
        listener({
          version: CONTRACT_VERSION,
          generation: 1,
          sequence,
          payload: { type: "status", data: { ...snapshot.status!, synced: sequence } }
        })
    })
    expect(commits).toHaveBeenCalledTimes(before)
  } finally {
    view.unmount()
    controller.dispose()
  }
})
