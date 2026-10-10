import { useSyncExternalStore } from "react"
const listeners = new Set<() => void>()
const owners = new Map<string, Set<string>>()
export function setCollaborationOwner(path: string, ownerId: string, active: boolean): void {
  const current = owners.get(path) ?? new Set<string>()
  if (active) current.add(ownerId)
  else current.delete(ownerId)
  if (current.size) owners.set(path, current)
  else owners.delete(path)
  for (const listener of listeners) listener()
}
export function collaborationOwner(path: string): string | undefined {
  return owners.get(path)?.values().next().value
}

export function useCollaborationOwner(path: string | undefined): string | undefined {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => (path ? collaborationOwner(path) : undefined)
  )
}
