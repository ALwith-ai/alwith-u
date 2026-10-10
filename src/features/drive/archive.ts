import type { DriveRequest, DriveResponse } from "@alwith/module-drive"

export interface ArchiveSource {
  list(
    check: () => void
  ): Promise<Array<{ sessionId: string; cwd: string; title: string | null; updatedAt: string | null }>>
  export(sessionId: string, check: () => void, signal: AbortSignal): Promise<string>
}
export interface ArchiveHost {
  source: ArchiveSource
  request(request: DriveRequest): Promise<DriveResponse>
  onError(error: unknown): void
}

/** No conversation cache: enumerate and export from the adapter only after native opt-in. */
export function createDriveArchive(host: ArchiveHost): { sync(): Promise<void>; dispose(): void } {
  const abort = new AbortController()
  let pending: Promise<void> | null = null
  const run = async (): Promise<void> => {
    const preferences = await host.request({ type: "preferences" })
    if (preferences.type !== "preferences") throw new Error("Invalid Drive preferences")
    if (!preferences.data.sessionArchive) return
    const initial = await host.request({ type: "snapshot" })
    if (initial.type !== "snapshot") throw new Error("Invalid Drive snapshot")
    if (!initial.data.configured || !initial.data.running) return
    const check = (): void => abort.signal.throwIfAborted()
    const privateResponse = await host.request({ type: "archivePrivateSessions" })
    if (privateResponse.type !== "archivePrivateSessions") throw new Error("Invalid private session list")
    const excluded = new Set(privateResponse.data)
    const sessions = await host.source.list(check)
    for (const session of sessions) {
      check()
      if (excluded.has(session.sessionId)) continue
      const current = await host.request({ type: "snapshot" })
      if (current.type !== "snapshot" || current.data.generation !== initial.data.generation) return
      const consent = await host.request({ type: "preferences" })
      if (consent.type !== "preferences" || !consent.data.sessionArchive) return
      try {
        const content = await host.source.export(session.sessionId, check, abort.signal)
        check()
        if (!content) continue
        const afterExport = await host.request({ type: "snapshot" })
        check()
        if (afterExport.type !== "snapshot" || afterExport.data.generation !== initial.data.generation) return
        await host.request({
          type: "archiveSession",
          expectedGeneration: initial.data.generation,
          sessionId: session.sessionId,
          cwd: session.cwd,
          title: session.title ?? session.sessionId,
          updatedAt: session.updatedAt ?? "",
          content
        })
      } catch (error) {
        if (abort.signal.aborted) return
        host.onError(error)
      }
    }
  }
  return {
    sync() {
      if (abort.signal.aborted) return Promise.resolve()
      if (!pending)
        pending = run().finally(() => {
          pending = null
        })
      return pending
    },
    dispose() {
      abort.abort()
    }
  }
}
