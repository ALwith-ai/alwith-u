import { CONTRACT_VERSION } from "@alwith/module-drive"
import type {
  DriveController,
  DriveRequest,
  DriveResponse,
  DriveState,
  Job,
  RootInfo,
  Snapshot
} from "@alwith/module-drive"
import { ChatCondenseEntry, type CondenseSnoozeHost } from "@alwith/module-drive/content"
import type { DriveControls } from "@alwith/module-drive/react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { expect, type Mock, test, vi } from "vitest"

const root: RootInfo = {
  projectId: 7,
  projectKey: "reports",
  name: "Reports",
  kind: "MATERIAL",
  scope: "PERSONAL",
  deptName: null,
  drivePath: "reports",
  node: "PERSONAL",
  container: "MATERIAL",
  nodePath: "",
  skillsPath: null,
  syncEnabled: true,
  canWrite: true,
  cloudOnly: false,
  cursor: "1",
  pinned: false,
  departmentId: null,
  ownerId: null,
  isMine: true,
  localPath: "/drive/reports",
  selected: true
}
const snapshot: Snapshot = {
  version: CONTRACT_VERSION,
  generation: 1,
  sequence: 0,
  configured: true,
  running: true,
  baseUrl: "https://drive.test",
  localRoot: "/drive",
  webBaseUrl: null,
  roots: [root],
  status: null,
  files: [],
  projects: [],
  pendingDeletes: [],
  error: null
}
const controls: DriveControls = {
  Button: ({ variant: _variant, size: _size, ...props }) => <button type="button" {...props} />,
  Input: (props) => <input {...props} />
}
const host: CondenseSnoozeHost = { readSnooze: async () => null, writeSnooze: async () => {} }
const proposal: Job = {
  id: 11,
  projectId: 7,
  type: "condense",
  status: "PROPOSED",
  progress: null,
  message: "Current proposal",
  error: null,
  result: null
}

function fixture(
  connected: boolean,
  respond: () => Promise<DriveResponse>
): {
  requests: DriveRequest[]
  onError: Mock<(error: unknown) => void>
  update: (patch: Partial<DriveState>) => void
} {
  let state: DriveState = { connected, snapshot, error: null }
  const listeners = new Set<() => void>()
  const requests: DriveRequest[] = []
  const controller: DriveController = {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    attach: async () => {},
    refresh: async () => {},
    dispose: () => {},
    request: async (request) => {
      requests.push(request)
      if (!state.connected) throw new Error("Drive is not connected")
      if (request.type !== "proposedCondense") throw new Error(`Unexpected request: ${request.type}`)
      return respond()
    }
  }
  const onError = vi.fn<(error: unknown) => void>()
  render(
    <ChatCondenseEntry
      cwd="/drive/reports"
      controller={controller}
      controls={controls}
      host={host}
      onBackgroundError={onError}
      onCondense={() => {}}
    />
  )
  return {
    requests,
    onError,
    update(patch: Partial<DriveState>): void {
      act(() => {
        state = { ...state, ...patch }
        for (const listener of listeners) listener()
      })
    }
  }
}

test("waits for attachment and queries proposals when connection becomes ready", async () => {
  const f = fixture(false, async () => ({ type: "jobs", data: [proposal] }))
  await act(async () => {})
  expect(f.requests).toEqual([])
  expect(f.onError).not.toHaveBeenCalled()
  expect(screen.getByRole("button", { name: "Condense into knowledge" })).toBeDisabled()
  f.update({ connected: true })
  await waitFor(() => expect(screen.getByTitle("Current proposal")).toBeInTheDocument())
  expect(f.requests).toEqual([{ type: "proposedCondense", projectId: 7 }])
})

test("ignores a failed lookup after disconnect and retries after reconnect", async () => {
  const pending = Promise.withResolvers<DriveResponse>()
  let calls = 0
  const f = fixture(true, () => (++calls === 1 ? pending.promise : Promise.resolve({ type: "jobs", data: [proposal] })))
  await waitFor(() => expect(f.requests).toHaveLength(1))
  f.update({ connected: false })
  await act(async () => {
    pending.reject(new Error("Attachment disposed"))
  })
  expect(f.onError).not.toHaveBeenCalled()
  fireEvent(window, new Event("focus"))
  await act(async () => {})
  expect(f.requests).toHaveLength(1)
  f.update({ connected: true })
  await waitFor(() => expect(screen.getByTitle("Current proposal")).toBeInTheDocument())
  expect(f.requests).toHaveLength(2)
})

test("requeries the same project after generation changes and ignores the previous result", async () => {
  const pending = Promise.withResolvers<DriveResponse>()
  let calls = 0
  const f = fixture(true, () => (++calls === 1 ? pending.promise : Promise.resolve({ type: "jobs", data: [proposal] })))
  await waitFor(() => expect(f.requests).toHaveLength(1))
  f.update({ snapshot: { ...snapshot, generation: 2 } })
  await waitFor(() => expect(screen.getByTitle("Current proposal")).toBeInTheDocument())
  await act(async () => {
    pending.resolve({ type: "jobs", data: [{ ...proposal, message: "Stale proposal" }] })
  })
  expect(screen.queryByTitle("Stale proposal")).not.toBeInTheDocument()
  expect(screen.getByTitle("Current proposal")).toBeInTheDocument()
  expect(f.requests).toHaveLength(2)
})

test("reports failures for the current attachment", async () => {
  const failure = new Error("Proposal service unavailable")
  const f = fixture(true, () => Promise.reject(failure))
  await waitFor(() => expect(f.onError).toHaveBeenCalledWith(failure))
})
