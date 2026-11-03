import { configureVibemon, initializeSettings } from "@alwith/module-auth/vibemon/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"

import { usePlatformAuth } from "@/features/auth/store"
import { createPlatformVibemonAssets } from "@/features/auth/vibemon-assets"

import { reportVibemonError } from "./display-error"
import { preventVibemonImageDragging } from "./image-drag"
import { createVibemonSessionClient } from "./session-client"
import { sessionIcons } from "./session-icons"
import { requestVibemon } from "./transport"
import { createVibemonWindowClient } from "./window-client"

export async function bootstrapVibemonWindow(): Promise<void> {
  const stopImageDragging = preventVibemonImageDragging()
  if (usePlatformAuth.getState().isLoading)
    await new Promise<void>((resolve) => {
      const stop = usePlatformAuth.subscribe((state) => {
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
  const assets = createPlatformVibemonAssets()
  const sessions = await createVibemonSessionClient()
  configureVibemon({
    sessionIcons,
    ...assets,
    sessions,
    windows: createVibemonWindowClient(),
    synchronizeResources: () => requestVibemon("sync-resources"),
    onError: reportVibemonError
  })
  await initializeSettings()
  const window = getCurrentWebviewWindow()
  if (window.label === "bubble-menu-vibemon") {
    await listen("vibemon:dismiss", () => document.dispatchEvent(new Event("vibemon:dismiss")))
  }
  addEventListener(
    "pagehide",
    () => {
      stopImageDragging()
      sessions.dispose()
      assets.dispose()
    },
    { once: true }
  )
}
