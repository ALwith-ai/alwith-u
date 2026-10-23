import {
  applyCollectionAction,
  type CollectionAction,
  type CollectionData,
  initialCollectionData
} from "@alwith/module-collection"
import { toast } from "sonner"
import { create } from "zustand"

import { settingsStore } from "@/lib/settings-store"

const key = "collections.data"
// Only organization preferences are persisted; Codex remains the session authority.
function readCollections(): CollectionData {
  const data = settingsStore.get<Omit<CollectionData, "sessionMeta">>(key)
  return data === undefined ? initialCollectionData() : { ...data, sessionMeta: {} }
}
export const useCollectionStore = create<CollectionData>(() => readCollections())
settingsStore.subscribe((keys) => {
  if (keys.includes(key)) useCollectionStore.setState(readCollections(), true)
})

let pending: Promise<unknown> = Promise.resolve()
export function dispatchCollection(action: CollectionAction | CollectionAction[]): Promise<void> {
  const operation = pending.then(async () => {
    const snapshot = await settingsStore.read()
    const actions = Array.isArray(action) ? action : [action]
    const next = actions.reduce(applyCollectionAction, readCollections())
    await settingsStore.write({
      action: "update",
      expectedRevision: snapshot.revision,
      changes: { [key]: { collections: next.collections, order: next.order } }
    })
  })
  // A failed write must not poison subsequent user actions.
  pending = operation.catch(() => {})
  return operation
}
export function reportCollection(promise: Promise<unknown>): void {
  void promise.catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
}
