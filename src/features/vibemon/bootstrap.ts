import { configureVibemon, initializeSettings } from "@alwith/module-auth/pets/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { createPlatformPetAssets } from "@/features/auth/pet-assets"
import { usePlatformAuth } from "@/features/auth/store"
import { reportPetError } from "./display-error"
import { createPetSessionClient } from "./session-client"
import { sessionIcons } from "./session-icons"
import { requestPet } from "./transport"
import { createPetWindowClient } from "./window-client"

export async function bootstrapVibemonWindow(): Promise<void> {
  if (usePlatformAuth.getState().isLoading)
    await new Promise<void>(resolve => {
      const stop = usePlatformAuth.subscribe(state => {
        if (!state.isLoading) {
          stop()
          resolve()
        }
      })
      if (!usePlatformAuth.getState().isLoading) {
        stop()
        resolve()
      }
    })
  if (usePlatformAuth.getState().user === null) throw new Error("Sign in to use Vibemon")
  const assets = createPlatformPetAssets()
  const sessions = await createPetSessionClient()
  configureVibemon({
    sessionIcons,
    ...assets,
    sessions,
    windows: createPetWindowClient(),
    synchronizeResources: () => requestPet("sync-resources"),
    onError: reportPetError
  })
  await initializeSettings()
  const window = getCurrentWebviewWindow()
  if (window.label === "bubble-menu-vibemon") {
    await listen("vibemon:dismiss", () => document.dispatchEvent(new Event("vibemon:dismiss")))
  }
  addEventListener(
    "pagehide",
    () => {
      sessions.dispose()
      assets.dispose()
    },
    { once: true }
  )
}
