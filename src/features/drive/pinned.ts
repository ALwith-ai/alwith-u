import { parsePinnedDocs, type PinnedDoc } from "@alwith/module-drive/react"
import { toast } from "sonner"
import { useSyncExternalStore } from "react"
const listeners = new Set<() => void>()
const cache = new Map<string, PinnedDoc[]>()
function read(profile: string): PinnedDoc[] {
  const stored = cache.get(profile)
  if (stored) return stored
  const raw = localStorage.getItem(`alwith:drive:pinned:${profile}`)
  let parsed: PinnedDoc[]
  try {
    parsed = parsePinnedDocs(raw === null ? [] : JSON.parse(raw))
  } catch (error) {
    parsed = []
    queueMicrotask(() => toast.error(`Unable to read pinned Drive documents: ${String(error)}`))
  }
  cache.set(profile, parsed)
  return parsed
}
export function saveDrivePins(profile: string, docs: PinnedDoc[]): void {
  localStorage.setItem(`alwith:drive:pinned:${profile}`, JSON.stringify(docs))
  cache.set(profile, docs)
  for (const listener of listeners) listener()
}
export function useDrivePins(profile: string): PinnedDoc[] {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => read(profile)
  )
}

export function rebaseDrivePins(profile: string, source: string, destination: string): void {
  const prefix = `${source.replace(/\/+$/, "")}/`
  saveDrivePins(
    profile,
    read(profile).map(doc =>
      doc.path === source || doc.path.startsWith(prefix)
        ? { ...doc, path: destination + doc.path.slice(source.length) }
        : doc
    )
  )
}
