import { configureVibemon, initializeSettings } from "@alwith/module-vibemon"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { toast } from "sonner"
import { createPlatformPetAssets } from "@/features/auth/pet-assets"
import { usePlatformAuth } from "@/features/auth/store"
import { requestPet } from "./transport"
import { createPetSessionClient } from "./session-client"
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
    ...assets,
    sessions,
    windows: createPetWindowClient(),
    synchronizeResources: () => requestPet("sync-resources"),
    onError: error => toast.error(error instanceof Error ? error.message : String(error))
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
