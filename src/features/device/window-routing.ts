import { appendComposerDraft, updateDraftAttachments } from "@alwith/module-chat/conversation"
import type { DeviceCapture } from "@alwith/module-device/preview"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { useEffect } from "react"
import { toast } from "sonner"

export const deviceSelections = new Map<string, string>()

export async function focusDeviceWindow(sessionId: string): Promise<boolean> {
  if (!isTauri()) return false
  const label = await invoke<string | null>("device_window_find", { sessionId })
  if (!label) return false
  const window = await WebviewWindow.getByLabel(label)
  if (!window) throw Error("Device window closed during routing")
  await window.unminimize()
  await window.show()
  await window.setFocus()
  return true
}
export function useDeviceWindowReturn(sessionId: string | null, reveal: () => void) {
  useEffect(() => {
    if (!sessionId || !isTauri()) return
    const stop = listen<{ sessionId: string; deviceId?: string }>("device-window-returned", ({ payload }) => {
      if (payload.deviceId) deviceSelections.set(payload.sessionId, payload.deviceId)
      if (payload.sessionId === sessionId) reveal()
    })
    return () => {
      void stop.then((dispose) => dispose()).catch((error: unknown) => toast.error(String(error)))
    }
  }, [sessionId, reveal])
}
/** Auxiliary windows route draft updates to the single main-window conversation store. */
export function useDeviceWindowContext() {
  useEffect(() => {
    if (!isTauri()) return
    const stop = listen<{ sessionId: string; text: string; capture?: DeviceCapture; url?: string }>(
      "device-window-context",
      ({ payload }) => {
        appendComposerDraft(payload.sessionId, payload.text)
        if (payload.capture?.kind === "image" && payload.url) {
          const capture = payload.capture,
            url = payload.url
          updateDraftAttachments(payload.sessionId, (attachments) => [
            ...attachments,
            { id: crypto.randomUUID(), type: "file", mediaType: "image/png", filename: capture.name, url }
          ])
        }
      }
    )
    return () => {
      void stop.then((dispose) => dispose()).catch((error: unknown) => toast.error(String(error)))
    }
  }, [])
}
