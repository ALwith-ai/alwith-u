import { sessionIconSvg, type PetWindowHost, type PetBinding, type PetSessionChoice } from "@alwith/module-vibemon"
import { invoke } from "@tauri-apps/api/core"
import { Image as TauriImage } from "@tauri-apps/api/image"
import { Menu } from "@tauri-apps/api/menu"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { LogicalPosition } from "@tauri-apps/api/window"
import { emitTo, listen } from "@tauri-apps/api/event"
import i18n from "@/lib/i18n"
import { requestPet } from "./transport"

let sessionMenu: Menu | null = null
async function chooseSession(payload: {
  binding: PetBinding
  candidates: PetSessionChoice[]
  position: { x: number; y: number }
  onSelect: (id: string) => Promise<void>
}) {
  if (sessionMenu !== null) {
    await sessionMenu.close()
    sessionMenu = null
  }
  const window = getCurrentWebviewWindow()
  const theme = await window.theme()
  const icons: TauriImage[] = []
  try {
    for (const candidate of payload.candidates) {
      const source = new globalThis.Image()
      source.src = `data:image/svg+xml,${encodeURIComponent(sessionIconSvg(candidate.windowLabel).replace("currentColor", theme === "dark" ? "white" : "black"))}`
      await source.decode()
      const canvas = document.createElement("canvas")
      canvas.width = 18
      canvas.height = 18
      const context = canvas.getContext("2d")
      if (context === null) throw new Error("Session menu requires Canvas 2D")
      context.drawImage(source, 0, 0, 18, 18)
      icons.push(await TauriImage.new(new Uint8Array(context.getImageData(0, 0, 18, 18).data), 18, 18))
    }
    sessionMenu = await Menu.new({
      items: payload.candidates.map((candidate, index) => ({
        id: candidate.sessionId,
        icon: icons[index],
        text: [
          candidate.cwd.split(/[\\/]/).filter(Boolean).at(-1),
          candidate.title || i18n.t("collection.defaultChatTitle", { ns: "common" })
        ]
          .filter(Boolean)
          .join(" / "),
        action: () => void payload.onSelect(candidate.sessionId)
      }))
    })
  } finally {
    await Promise.all(icons.map(icon => icon.close()))
  }
  await petWindowCall("focus")
  await sessionMenu.popup(new LogicalPosition(payload.position.x, payload.position.y), window)
}

export function petWindowCall<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (action === "session-menu") return chooseSession(payload as Parameters<typeof chooseSession>[0]) as Promise<T>
  if (action === "bubble-interact" || action === "dismiss-result") return requestPet(action, payload)
  if (action === "menu") payload = { ...payload, closeLabel: i18n.t("pet.hide") }
  return invoke<T>("vibemon_window", { action, payload })
}
export function createPetWindowClient(): PetWindowHost {
  return {
    call: petWindowCall,
    openPet: (options = {}) => requestPet("open-pet", options),
    closePet: () => requestPet("close-pet"),
    openRecharge: () => requestPet("recharge"),
    async geometry(listener) {
      const window = getCurrentWebviewWindow()
      const stops = await Promise.all([window.onScaleChanged(listener), window.onResized(listener)])
      return () => {
        for (const stop of stops) stop()
      }
    },
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
export async function collapseChatToPet(sessionId: string | null, signal?: AbortSignal): Promise<void> {
  await requestPet("collapse", { sessionId }, signal)
}
export async function restorePetAfterChat(): Promise<void> {
  await requestPet("restore-pet")
}

export async function suspendPetForChat(): Promise<void> {
  await requestPet("hide-pet")
}
