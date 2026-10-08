import { emitTo, listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { API_BASE_URL, usePlatformAuth } from "@/features/auth/store"

export type PetRequest = { id: string; from: string; scope: string; deadline: number; action: string; payload: unknown }
export function petScope(): string {
  const user = usePlatformAuth.getState().user
  if (user === null) throw new Error("Sign in to use Vibemon")
  return `${new URL(API_BASE_URL).host}/${user.user_uuid}`
}
export async function requestPet<T>(action: string, payload: unknown = null): Promise<T> {
  const id = crypto.randomUUID()
  const current = getCurrentWebviewWindow()
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const result = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  const stop = await listen<{ id: string; value: T; error: string | null }>(
    "vibemon:response",
    ({ payload: response }) => {
      if (response.id !== id) return
      if (response.error !== null) reject(new Error(response.error))
      else resolve(response.value)
    }
  )
  const deadline = Date.now() + 20_000
  const timer = setTimeout(
    () => reject(new Error("Vibemon request timed out; check the conversation before retrying")),
    20_000
  )
  try {
    await emitTo("main", "vibemon:request", {
      id,
      from: current.label,
      scope: petScope(),
      deadline,
      action,
      payload
    } satisfies PetRequest)
    return await result
  } finally {
    clearTimeout(timer)
    stop()
  }
}
export async function servePetRequests(handler: (request: PetRequest) => Promise<unknown>): Promise<() => void> {
  if (getCurrentWebviewWindow().label !== "main") throw new Error("Only main serves Vibemon requests")
  return listen<PetRequest>("vibemon:request", ({ payload: request }) => {
    void (async () => {
      let value: unknown = null
      let error: string | null = null
      try {
        if (!["main", "chat", "vibemon", "vibemon-center", "bubble-menu-vibemon"].includes(request.from))
          throw new Error("Invalid Vibemon sender")
        if (Date.now() >= request.deadline || request.scope !== petScope()) throw new Error("Vibemon request expired")
        value = await handler(request)
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure)
      }
      await emitTo(request.from, "vibemon:response", { id: request.id, value, error })
    })().catch(console.error)
  })
}
