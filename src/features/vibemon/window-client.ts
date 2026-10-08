import type { PetWindowHost } from "@alwith/module-vibemon"
import { invoke } from "@tauri-apps/api/core"
import { emitTo, listen } from "@tauri-apps/api/event"
import { requestPet } from "./transport"

export function petWindowCall<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>("vibemon_window", { action, payload })
}
export function createPetWindowClient(): PetWindowHost {
  return {
    call: petWindowCall,
    openPet: () => requestPet("open-pet"),
    closePet: () => requestPet("close-pet"),
    openRecharge: () => requestPet("recharge"),
    commands(listener) {
      let disposed = false
      const work = listen<Parameters<typeof listener>[0]>("vibemon:command", ({ payload }) => {
        if (disposed) return
        void (async () => {
          let error: string | null = null
          try {
            await listener(payload)
          } catch (failure) {
            error = failure instanceof Error ? failure.message : String(failure)
          }
          await emitTo("main", "vibemon:command-result", { requestId: payload.requestId, error })
        })().catch(console.error)
      })
      return () => {
        disposed = true
        void work.then(stop => stop())
      }
    }
  }
}
export async function registerPetSurface(
  label: "main" | "chat",
  sessionId: string | null,
  visible: boolean
): Promise<void> {
  await requestPet("surface", { label, sessionId, visible })
}
export async function collapseChatToPet(sessionId: string | null): Promise<void> {
  await requestPet("collapse", { sessionId })
}
export async function restorePetAfterChat(): Promise<void> {
  await requestPet("restore-pet")
}

export async function suspendPetForChat(): Promise<void> {
  await requestPet("hide-pet")
}
