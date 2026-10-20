import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { useEffect, useState } from "react"

/** Match Desktop's auxiliary navigation: focus changes refresh main-window presence. */
export function useMainWindowVisible(onError: (error: unknown) => void): boolean {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    let disposed = false
    let version = 0
    const refresh = async (): Promise<void> => {
      const request = ++version
      const main = await WebviewWindow.getByLabel("main")
      const next = main !== null && (await main.isVisible())
      if (!disposed && request === version) setVisible(next)
    }
    const update = (): void => {
      void refresh().catch(onError)
    }
    update()
    const stop = getCurrentWebviewWindow().onFocusChanged(update)
    return () => {
      disposed = true
      void stop.then((unlisten) => unlisten()).catch(onError)
    }
  }, [onError])
  return visible
}
