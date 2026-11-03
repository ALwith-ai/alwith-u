import type { VibemonObservation, VibemonSessionHost } from "@alwith/module-auth/vibemon/core"
import { listen } from "@tauri-apps/api/event"

import { inspectVibemon, requestVibemon } from "./transport"

export async function createVibemonSessionClient(): Promise<VibemonSessionHost & { dispose: () => void }> {
  let snapshot: VibemonObservation | null = null
  let revision = 0
  const listeners = new Set<(value: VibemonObservation | null) => void>()
  const stop = await listen<VibemonObservation | null>("vibemon:observation", ({ payload }) => {
    if (
      payload !== null &&
      snapshot !== null &&
      payload.binding.connectionEpoch === snapshot.binding.connectionEpoch &&
      payload.revision <= revision
    )
      return
    snapshot = payload
    revision = payload?.revision ?? 0
    for (const listener of listeners) listener(snapshot)
  })
  let updates = 0
  const unregister = () => {
    updates++
  }
  listeners.add(unregister)
  const baseline = updates
  let initial: VibemonObservation | null
  try {
    initial = await inspectVibemon<VibemonObservation | null>()
  } catch (error) {
    stop()
    listeners.clear()
    throw error
  }
  if (updates === baseline) {
    snapshot = initial
    revision = initial?.revision ?? 0
  }
  listeners.delete(unregister)
  return {
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    panel: (level) => requestVibemon("task-panel", { level }),
    cancel: (binding, requestId) => requestVibemon("cancel-task", { binding, requestId }),
    dismiss: (binding) => requestVibemon("dismiss-task", { binding }),
    send: (binding, requestId, text) => requestVibemon("send", { binding, requestId, text }),
    answer: (binding, requestId, token, optionId) => requestVibemon("answer", { binding, requestId, token, optionId }),
    openChat: (binding) => requestVibemon("open-chat", { binding }),
    activate: () => requestVibemon("activate"),
    select: (binding, sessionId) => requestVibemon("select-session", { binding, sessionId }),
    dispose() {
      stop()
      listeners.clear()
    }
  }
}
