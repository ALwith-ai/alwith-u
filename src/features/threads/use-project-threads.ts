import { useEffect, useMemo } from "react"
import { useStore } from "zustand"

import { client } from "@/lib/client"

import { isQuickChatDirectory } from "./thread-groups"

export function useProjectThreads(cwd: string | null) {
  const project = cwd === null ? null : client.projectPath(cwd)
  const threads = useStore(client.store, (state) => state.threads)
  const connection = useStore(client.store, (state) => state.connection)
  const loaded = useStore(client.store, (state) => state.threadsLoaded)
  const error = useStore(client.store, (state) => state.threadsError)
  const retry = () => client.listThreads({ reset: true }).catch(() => undefined)
  useEffect(() => {
    if (connection === "ready" && !loaded && error === null) void client.listThreads().catch(() => undefined)
  }, [connection, loaded, error])
  const result = useMemo(() => {
    if (loaded)
      return {
        status: "ready" as const,
        threads: threads
          .filter((thread) =>
            project === null ? isQuickChatDirectory(thread.cwd) : client.projectPath(thread.cwd) === project
          )
          .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
      }
    if (error !== null) return { status: "failed" as const, error }
    return { status: "loading" as const }
  }, [threads, loaded, error, project])
  return { result, retry }
}
