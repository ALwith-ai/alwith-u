import type { PetObservation, PetSessionHost } from "@alwith/module-vibemon"
import { listen } from "@tauri-apps/api/event"
import { requestPet } from "./transport"

export async function createPetSessionClient(): Promise<PetSessionHost & { dispose(): void }> {
  let snapshot: PetObservation | null = null
  let revision = 0
  const listeners = new Set<(value: PetObservation | null) => void>()
  const stop = await listen<PetObservation | null>("vibemon:observation", ({ payload }) => {
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
  const initial = await requestPet<PetObservation | null>("inspect")
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
    send: (binding, requestId, text) => requestPet("send", { binding, requestId, text }),
    answer: (binding, requestId, token, optionId) => requestPet("answer", { binding, requestId, token, optionId }),
    openChat: binding => requestPet("open-chat", { binding }),
    dispose() {
      stop()
      listeners.clear()
    }
  }
}
