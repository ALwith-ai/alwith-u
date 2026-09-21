import { useEffect, useState } from "react"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"

/** Hidden/minimized windows must not consume Runtime's done state. */
export function useWindowFocus(): boolean {
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    const window = getCurrentWebviewWindow()
    let disposed = false
    const stop = window.onFocusChanged(({ payload }) => {
      if (!disposed) setFocused(payload)
    })
    void window.isFocused().then(value => {
      if (!disposed) setFocused(value)
    })
    return () => {
      disposed = true
      void stop.then(unlisten => unlisten())
    }
  }, [])
  return focused
}
