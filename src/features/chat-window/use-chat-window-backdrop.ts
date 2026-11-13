import { getCurrentWindow } from "@tauri-apps/api/window"
import { useEffect } from "react"

import { commands } from "@/bindings"

/**
 * Keeps the native backdrop in step with the transparency preference. The corner radius is
 * given in CSS pixels and converted to native points, so page zoom and display scale changes
 * keep the glass aligned with the shell. A null radius clears the backdrop.
 */
export function useChatWindowBackdrop(transparent: boolean, cornerRadius: number): void {
  useEffect(() => {
    const currentWindow = getCurrentWindow()
    let cancelled = false
    let applied: number | null | undefined
    // Requests are applied in order so a late response cannot restore an older state.
    let pending = Promise.resolve()
    const apply = async (): Promise<void> => {
      if (cancelled) return
      // devicePixelRatio includes page zoom; scaleFactor is the display scale alone.
      const radius = transparent ? (cornerRadius * window.devicePixelRatio) / (await currentWindow.scaleFactor()) : null
      if (cancelled || radius === applied) return
      await commands.setChatWindowBackdrop({ cornerRadius: radius })
      applied = radius
    }
    const schedule = (): void => {
      const previous = pending
      pending = (async () => {
        await previous.catch(() => {})
        await apply()
      })()
      void pending
    }
    schedule()
    // Page zoom changes devicePixelRatio and fires resize; moving between displays changes the scale.
    window.addEventListener("resize", schedule)
    const scaleListener = currentWindow.onScaleChanged(schedule)
    return () => {
      cancelled = true
      window.removeEventListener("resize", schedule)
      void scaleListener.then((unlisten) => unlisten())
    }
  }, [transparent, cornerRadius])
}
