import { appendComposerDraft, updateDraftAttachments } from "@alwith/module-chat/conversation"
import type { DeviceCapture } from "@alwith/module-device/preview"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { useEffect } from "react"
import { toast } from "sonner"

import { client } from "@/lib/client"

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
/**
 * Delivers what a person said about something on a device's screen to the conversation the device
 * belongs to, at once: their words, with what they pointed at attached as context.
 */
export async function sendDeviceRemark(sessionId: string, text: string, context: string): Promise<void> {
  await client.prompt(sessionId, [
    { type: "text", text },
    { type: "resource", resource: { uri: "device:screen", mimeType: "text/plain", text: context } }
  ])
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
    // A remark made in a device window of its own is delivered from here, where the conversation is.
    const stopRemarks = listen<{ sessionId: string; text: string; context: string }>(
      "device-window-remark",
      ({ payload }) => {
        void sendDeviceRemark(payload.sessionId, payload.text, payload.context).catch((error: unknown) =>
          toast.error(String(error))
        )
      }
    )
    return () => {
      for (const stopped of [stop, stopRemarks])
        void stopped.then((dispose) => dispose()).catch((error: unknown) => toast.error(String(error)))
    }
  }, [])
}
