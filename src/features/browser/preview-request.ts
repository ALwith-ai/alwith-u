import { listen } from "@tauri-apps/api/event"
import { useEffect, useState } from "react"
import { toast } from "sonner"

export interface PreviewRequest {
  id: string
  url: string
  sessionId?: string
}

export function usePreviewRequest(enabled: boolean, show: () => void) {
  const [request, setRequest] = useState<PreviewRequest>()
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    const subscription = listen<PreviewRequest>("browser-preview-open", ({ payload }) => {
      if (disposed) return
      setRequest(payload)
      show()
    })
    const focusSubscription = listen("browser-tab-focus", () => {
      if (!disposed) show()
    })
    const popupSubscription = listen("browser-popup-created", () => {
      if (!disposed) show()
    })
    // A page an extension opened waits for the pane to take it.
    const requestedSubscription = listen("browser-open-tab", () => {
      if (!disposed) show()
    })
    void requestedSubscription.catch((error) => toast.error(String(error)))
    void popupSubscription.catch((error) => toast.error(String(error)))
    void focusSubscription.catch((error) => toast.error(String(error)))
    void subscription.catch((error) => toast.error(String(error)))
    return () => {
      disposed = true
      void requestedSubscription.then((unlisten) => unlisten()).catch(() => {})
      void popupSubscription.then((unlisten) => unlisten()).catch(() => {})
      void focusSubscription.then((unlisten) => unlisten()).catch(() => {})
      void subscription.then((unlisten) => unlisten()).catch(() => {})
    }
  }, [enabled, show])
  return request
}
