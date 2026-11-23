import { useDesktopCanvas } from "@alwith/module-desktop-shell/react"

/** Outside the desktop canvas the host presents its pane directly. */
export function useCanvasPaneVisible(pane: "chat" | "preview" | "browser"): boolean {
  const canvas = useDesktopCanvas()
  return canvas === null || canvas.visibleRegions.includes(pane)
}
