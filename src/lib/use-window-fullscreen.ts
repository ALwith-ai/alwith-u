import { isTauri } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { useEffect, useState } from "react"

/** Native fullscreen is independent of the DOM fullscreen API and window maximization. */
export function useWindowFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    if (!isTauri()) return
    const window = getCurrentWebviewWindow()
    let disposed = false
    let revision = 0
    const refresh = async () => {
      const request = ++revision
      const value = await window.isFullscreen()
      if (!disposed && request === revision) setFullscreen(value)
    }
    const stop = window.onResized(() => void refresh())
    void stop.then(refresh)
    return () => {
      disposed = true
      void stop.then((unlisten) => unlisten())
    }
  }, [])
  return fullscreen
}
