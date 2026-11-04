import { CONTRACT_VERSION, createDriveController, type Snapshot } from "@alwith/module-drive"
import { type DriveControls, DrivePanel } from "@alwith/module-drive/react"
import { act, render, screen } from "@testing-library/react"
import { expect, test } from "vitest"

const controls: DriveControls = {
  Button: ({ variant: _variant, size: _size, ...props }) => <button type="button" {...props} />,
  Input: (props) => <input {...props} />
}

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
