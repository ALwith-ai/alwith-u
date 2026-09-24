import { useEffect } from "react"
import { useStore } from "zustand"
import { client } from "@/lib/client"
import { ProjectThreadCache } from "./project-thread-cache"

const cache = new ProjectThreadCache(async cwd => {
  await client.connect()
  return client.listProjectThreads(cwd)
})

client.store.subscribe((state, previous) => {
  if (previous.connection === "ready" && (state.connection === "disconnected" || state.connection === "failed")) {
    cache.invalidate()
  } else if (state.threads !== previous.threads || state.archivedThreads !== previous.archivedThreads) {
    cache.synchronize([...previous.threads, ...previous.archivedThreads], [...state.threads, ...state.archivedThreads])
  }
})

export function useProjectThreads(cwd: string) {
  const result = useStore(cache.store, state => state[cwd])
  useEffect(() => {
    if (result === undefined) cache.load(cwd)
  }, [cwd, result])
  return { result, retry: () => cache.invalidate([cwd]) }
}
