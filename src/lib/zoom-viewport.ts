import { isTauri } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"

/** Native logical width does not change with page zoom; CSS viewport units change in the same layout pass. */
export async function startZoomViewport(): Promise<() => void> {
  if (!isTauri()) return () => {}
  const window = getCurrentWebviewWindow()
  let disposed = false
  let revision = 0
  const refresh = async () => {
    const request = ++revision
    const [size, scale] = await Promise.all([window.innerSize(), window.scaleFactor()])
    if (disposed || request !== revision || size.width === 0) return
    document.documentElement.style.setProperty("--native-viewport-width", `${size.width / scale}px`)
  }
  const stops = await Promise.all([window.onResized(() => void refresh()), window.onScaleChanged(() => void refresh())])
  const stop = () => {
    disposed = true
    for (const unlisten of stops) unlisten()
  }
  try {
    await refresh()
    return stop
  } catch (error) {
    stop()
    throw error
  }
}
