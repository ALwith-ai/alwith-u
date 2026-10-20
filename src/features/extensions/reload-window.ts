import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"

import type { ReloadOutcome } from "./reload-service"

interface ReloadRequest {
  requestId: string
  id: string
  replyTo: string
}
interface ReloadReply {
  requestId: string
  outcome?: ReloadOutcome
  error?: string
}

/** Main owns activation checks and source cleanup even when settings closes. */
export async function serveMainReload(action: (id: string) => Promise<ReloadOutcome>): Promise<UnlistenFn> {
  if (getCurrentWindow().label !== "main") throw new Error("Only main can serve extension reloads")
  return listen<ReloadRequest>(
    "extension:reload-request",
    ({ payload }) => {
      if (
        !payload ||
        typeof payload.id !== "string" ||
        typeof payload.requestId !== "string" ||
        !["settings", "chat"].includes(payload.replyTo)
      )
        return
      void (async () => {
        let reply: ReloadReply
        try {
          reply = { requestId: payload.requestId, outcome: await action(payload.id) }
        } catch (error) {
          reply = { requestId: payload.requestId, error: error instanceof Error ? error.message : String(error) }
        }
        await emitTo(payload.replyTo, "extension:reload-result", reply)
      })().catch(error => console.error("Extension reload result delivery failed", error))
    },
    { target: { kind: "Window", label: "main" } }
  )
}

export async function requestMainReload(id: string): Promise<ReloadOutcome> {
  const requestId = crypto.randomUUID()
  const replyTo = getCurrentWindow().label
  let resolve!: (outcome: ReloadOutcome) => void
  let reject!: (error: Error) => void
  const result = new Promise<ReloadOutcome>((res, rej) => {
    resolve = res
    reject = rej
  })
  const stop = await listen<ReloadReply>(
    "extension:reload-result",
    ({ payload }) => {
      if (payload?.requestId !== requestId) return
      if (payload.error) reject(new Error(payload.error))
      else if (payload.outcome === "updated" || payload.outcome === "reloaded") resolve(payload.outcome)
      else reject(new Error("Invalid extension reload response"))
    },
    { target: { kind: "Window", label: replyTo } }
  )
  const timer = setTimeout(
    () => reject(new Error("Main window reload response timed out; the operation may still be running")),
    180_000
  )
  try {
    // Observe the result immediately, including failures before event delivery finishes.
    const [outcome] = await Promise.all([
      result,
      emitTo("main", "extension:reload-request", { requestId, id, replyTo })
    ])
    return outcome
  } finally {
    clearTimeout(timer)
    stop()
  }
}
