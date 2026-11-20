import { CONTRACT_VERSION, createDriveController, type Snapshot } from "@alwith/module-drive"
import { type DriveControls, DrivePanel, summarize } from "@alwith/module-drive/react"
import { act, render, screen } from "@testing-library/react"
import { expect, test } from "vitest"

const controls: DriveControls = {
  Button: ({ variant: _variant, size: _size, ...props }) => <button type="button" {...props} />,
  Input: (props) => <input {...props} />
}

test("the badge and transfer details follow the engine status when a download settles", async () => {
  const status: NonNullable<Snapshot["status"]> = {
    state: { kind: "syncing" },
    downloading: 1,
    uploading: 0,
    pending: 0,
    synced: 0,
    failed: 0,
    lastSyncAt: null,
    pushConnected: true,
    conflicts: [],
    errors: []
  }
  let snapshot: Snapshot = {
    version: CONTRACT_VERSION,
    generation: 1,
    sequence: 0,
    configured: true,
    running: true,
    baseUrl: "https://drive.test",
    localRoot: "/drive",
    webBaseUrl: null,
    roots: [],
    files: [{ projectId: 1, path: "report.html", localPath: "/drive/report.html", state: "downloading", size: 0 }],
    projects: [],
    pendingDeletes: [],
    error: null,
    status
  }
  const controller = createDriveController({
    subscribe: async () => () => {},
    request: async (request) => {
      if (request.type === "snapshot") return { type: "snapshot", data: snapshot }
      if (request.type === "failedUploads") return { type: "failedUploads", data: [] }
      throw new Error(`Unexpected Drive request: ${request.type}`)
    }
  })
  await controller.attach()
  const view = render(
    <DrivePanel
      controller={controller}
      controls={controls}
      mode="status"
      locale="en"
      onOpenProject={async () => {}}
      confirm={async () => false}
    />
  )
  try {
    expect(screen.getByText("Transferring (1)")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "report.html" })).toBeInTheDocument()
    expect(screen.queryByText("0 B")).not.toBeInTheDocument()

    const settled = { ...status, downloading: 0 }
    snapshot = { ...snapshot, sequence: 1, status: settled }
    await act(() => controller.refresh())
    expect(screen.getByRole("status")).toHaveTextContent(/^Syncing$/)
    expect(screen.queryByText("Transferring (1)")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "report.html" })).not.toBeInTheDocument()
    expect(summarize(settled).key).toBe("drive.engine.syncing")
    expect(summarize({ ...settled, state: { kind: "idle" } }).key).toBe("drive.summary.upToDate")
  } finally {
    view.unmount()
    controller.dispose()
  }
})

test("idle sync reports server errors and becomes up to date only after recovery", async () => {
  let snapshot: Snapshot = {
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
      downloading: 0,
      uploading: 0,
      pending: 0,
      synced: 1,
      failed: 0,
      lastSyncAt: null,
      pushConnected: false,
      conflicts: [],
      errors: ["Root list unavailable", "Project A unavailable", "Project B unavailable"].map((message) => ({
        projectId: null,
        path: null,
        message,
        at: "2026-11-03T00:00:00Z"
      }))
    }
  }
  const controller = createDriveController({
    subscribe: async () => () => {},
    request: async (request) => {
      if (request.type === "snapshot") return { type: "snapshot", data: snapshot }
      if (request.type === "failedUploads") return { type: "failedUploads", data: [] }
      throw new Error(`Unexpected Drive request: ${request.type}`)
    }
  })
  await controller.attach()
  const view = render(
    <DrivePanel
      controller={controller}
      controls={controls}
      mode="status"
      locale="en"
      onOpenProject={async () => {}}
      confirm={async () => false}
    />
  )
  try {
    expect(screen.getByRole("status")).toHaveTextContent(/^Sync issues \(3\)$/)
    expect(screen.queryByText("Up to date")).not.toBeInTheDocument()
    const status = snapshot.status
    if (!status) throw new Error("Fixture status is required")
    snapshot = { ...snapshot, sequence: 1, status: { ...status, errors: [] } }
    await act(() => controller.refresh())
    expect(screen.getByRole("status")).toHaveTextContent(/^Up to date$/)
    expect(screen.queryByText("Sync issues (3)")).not.toBeInTheDocument()
  } finally {
    view.unmount()
    controller.dispose()
  }
})
