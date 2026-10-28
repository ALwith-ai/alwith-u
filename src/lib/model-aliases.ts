import { useSyncExternalStore } from "react"

import { settingsStore } from "./settings-store"

export type ModelAliases = Readonly<Record<string, string>>
const key = "chat.modelAliases"
const empty: ModelAliases = {}
const prefix = "gateway:alwith-managed-litellm:"

function aliases(value: unknown): ModelAliases {
  if (value === undefined) return empty
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.entries(value).some(
      ([id, label]) =>
        !id.startsWith(prefix) ||
        id.length === prefix.length ||
        typeof label !== "string" ||
        !label.trim() ||
        label.length > 100
    )
  )
    throw new Error("Invalid model aliases")
  return value as ModelAliases
}

function subscribe(notify: () => void): () => void {
  return settingsStore.subscribe((keys) => {
    if (keys.includes(key)) notify()
  })
}

export function useModelAliases(): ModelAliases {
  return useSyncExternalStore(subscribe, () => aliases(settingsStore.get(key)))
}

export async function saveModelAlias(id: string, label: string): Promise<void> {
  if (!id.startsWith(prefix) || id.length === prefix.length) throw new Error("Invalid ALwith model ID")
  const snapshot = await settingsStore.read()
  const next = { ...aliases(snapshot.values[key]) }
  const trimmed = label.trim()
  if (trimmed) next[id] = trimmed
  else delete next[id]
  aliases(next)
  // Reject a concurrent settings change instead of overwriting another window's aliases.
  await settingsStore.write({ action: "update", expectedRevision: snapshot.revision, changes: { [key]: next } })
}
