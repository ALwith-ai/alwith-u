import type { DriveRequest, DriveResponse } from "@alwith/module-drive"
import { expect, test, vi } from "vitest"

import { createDriveArchive } from "../archive"

const source = () => ({
  list: vi.fn(() =>
    Promise.resolve([
      { sessionId: "private", cwd: "/drive", title: null, updatedAt: null },
      { sessionId: "public", cwd: "/drive", title: null, updatedAt: null }
    ])
  ),
  export: vi.fn(() => Promise.resolve("messages"))
})
test("disabled archive never enumerates or exports history", async () => {
  const history = source()
  const archive = createDriveArchive({
    source: history,
    request: () => Promise.resolve({ type: "preferences", data: { sessionArchive: false, knowledgeInject: false } }),
    onError: vi.fn()
  })
  await archive.sync()
  expect(history.list).not.toHaveBeenCalled()
  expect(history.export).not.toHaveBeenCalled()
  archive.dispose()
})
test("private conversations are excluded before export and profile changes stop uploads", async () => {
  const history = source()
  const uploads: DriveRequest[] = []
  let snapshots = 0
  const request = (value: DriveRequest): Promise<DriveResponse> => {
    return Promise.try(() => {
      if (value.type === "preferences")
        return { type: "preferences", data: { sessionArchive: true, knowledgeInject: false } }
      if (value.type === "archivePrivateSessions") return { type: "archivePrivateSessions", data: ["private"] }
      if (value.type === "snapshot")
        return {
          type: "snapshot",
          data: {
            version: 1,
            generation: ++snapshots,
            sequence: 0,
            configured: true,
            running: true,
            baseUrl: "https://example.test",
            localRoot: "/drive",
            webBaseUrl: null,
            status: null,
            roots: [],
            pendingDeletes: [],
            files: [],
            projects: [],
            error: null
          }
        }
      uploads.push(value)
      return { type: "count", data: 1 }
    })
  }
  const archive = createDriveArchive({ source: history, request, onError: vi.fn() })
  await archive.sync()
  expect(history.export).not.toHaveBeenCalled()
  expect(uploads).toEqual([])
  archive.dispose()
})

test("a profile change during export discards the exported conversation", async () => {
  const history = source()
  let generation = 1
  const uploads: DriveRequest[] = []
  history.export.mockImplementation(() => {
    generation = 2
    return Promise.resolve("old account conversation")
  })
  const request = (value: DriveRequest): Promise<DriveResponse> => {
    return Promise.try(() => {
      if (value.type === "preferences")
        return { type: "preferences", data: { sessionArchive: true, knowledgeInject: false } }
      if (value.type === "archivePrivateSessions") return { type: "archivePrivateSessions", data: ["private"] }
      if (value.type === "snapshot")
        return {
          type: "snapshot",
          data: {
            version: 1,
            generation,
            sequence: 0,
            configured: true,
            running: true,
            baseUrl: "https://example.test",
            localRoot: "/drive",
            webBaseUrl: null,
            status: null,
            roots: [],
            pendingDeletes: [],
            files: [],
            projects: [],
            error: null
          }
        }
      uploads.push(value)
      return { type: "count", data: 1 }
    })
  }
  const archive = createDriveArchive({ source: history, request, onError: vi.fn() })
  await archive.sync()
  expect(history.export).toHaveBeenCalledTimes(1)
  expect(uploads).toEqual([])
  archive.dispose()
})

test("archive uploads carry the initial profile generation for native atomic validation", async () => {
  const history = source()
  const uploads: DriveRequest[] = []
  const request = (value: DriveRequest): Promise<DriveResponse> => {
    return Promise.try(() => {
      if (value.type === "preferences")
        return { type: "preferences", data: { sessionArchive: true, knowledgeInject: false } }
      if (value.type === "archivePrivateSessions") return { type: "archivePrivateSessions", data: ["private"] }
      if (value.type === "snapshot")
        return {
          type: "snapshot",
          data: {
            version: 1,
            generation: 17,
            sequence: 0,
            configured: true,
            running: true,
            baseUrl: "https://example.test",
            localRoot: "/drive",
            webBaseUrl: null,
            status: null,
            roots: [],
            pendingDeletes: [],
            files: [],
            projects: [],
            error: null
          }
        }
      uploads.push(value)
      return { type: "count", data: 1 }
    })
  }
  const archive = createDriveArchive({ source: history, request, onError: vi.fn() })
  await archive.sync()
  expect(uploads).toEqual([
    expect.objectContaining({
      type: "archiveSession",
      expectedGeneration: 17,
      sessionId: "public",
      content: "messages"
    })
  ])
  archive.dispose()
})
