import { type CollectionData, DEFAULT_COLLECTION_ID } from "@alwith/module-collection"
import { beforeEach, expect, test, vi } from "vitest"

import { type SettingsSnapshot, settingsStore } from "@/lib/settings-store"

import { dispatchCollection, useCollectionStore } from "../store"

let snapshot: SettingsSnapshot
let fail = false
let conflict = false
beforeEach(() => {
  vi.restoreAllMocks()
  snapshot = { revision: 100, values: {}, browserMigrated: true }
  fail = false
  conflict = false
  vi.spyOn(settingsStore, "get").mockImplementation((key) => snapshot.values[key])
  vi.spyOn(settingsStore, "read").mockImplementation(async () => snapshot)
  vi.spyOn(settingsStore, "write").mockImplementation(async (request) => {
    if (fail) throw new Error("Disk full")
    if (conflict) throw new Error("Settings changed in another window; reload and retry")
    expect(request.expectedRevision).toBe(snapshot.revision)
    snapshot = { ...snapshot, revision: snapshot.revision + 1, values: { ...snapshot.values, ...request.changes } }
    const saved = snapshot.values["collections.data"] as Omit<CollectionData, "sessionMeta">
    useCollectionStore.setState({ ...saved, sessionMeta: {} })
    return snapshot
  })
})

test("serializes concurrent user actions and saves only organization preferences", async () => {
  await Promise.all([
    dispatchCollection({ type: "create", id: "a", name: "Alpha", sessionId: "chat" }),
    dispatchCollection({ type: "create", id: "b", name: "Beta" }),
    dispatchCollection({ type: "add", collectionId: "b", sessionId: "chat" })
  ])
  expect(useCollectionStore.getState().collections.a.sessionIds).toEqual([])
  expect(useCollectionStore.getState().collections.b.sessionIds).toEqual(["chat"])
  expect(snapshot.values["collections.data"]).not.toHaveProperty("sessionMeta")
})

test("failed writes preserve visible data and the next user action can succeed", async () => {
  await dispatchCollection({ type: "add", collectionId: DEFAULT_COLLECTION_ID, sessionId: "chat" })
  fail = true
  await expect(dispatchCollection({ type: "remove", sessionId: "chat" })).rejects.toThrow("Disk full")
  expect(useCollectionStore.getState().collections[DEFAULT_COLLECTION_ID].sessionIds).toEqual(["chat"])
  fail = false
  await dispatchCollection({ type: "remove", sessionId: "chat" })
  expect(useCollectionStore.getState().collections[DEFAULT_COLLECTION_ID].sessionIds).toEqual([])
})

test("does not overwrite another window when the revision changes", async () => {
  await dispatchCollection({ type: "create", id: "a", name: "Alpha" })
  conflict = true
  await expect(dispatchCollection({ type: "rename", id: "a", name: "Lost update" })).rejects.toThrow("another window")
  expect(useCollectionStore.getState().collections.a.name).toBe("Alpha")
})

test("saves collection identity and emoji in one settings transaction", async () => {
  await dispatchCollection([
    { type: "create", id: "a", name: "Alpha" },
    { type: "emoji", id: "a", emoji: "⭐" }
  ])
  expect(settingsStore.write).toHaveBeenCalledTimes(1)
  expect(useCollectionStore.getState().collections.a).toMatchObject({ name: "Alpha", emoji: "⭐" })
  fail = true
  await expect(
    dispatchCollection([
      { type: "rename", id: "a", name: "Beta" },
      { type: "emoji", id: "a", emoji: "📁" }
    ])
  ).rejects.toThrow("Disk full")
  expect(useCollectionStore.getState().collections.a).toMatchObject({ name: "Alpha", emoji: "⭐" })
})
