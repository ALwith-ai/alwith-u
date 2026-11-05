import { isTauri } from "@tauri-apps/api/core"

import { zoomStore } from "./zoom"

/** Native-sized controls need inverse page zoom, independent of window dimensions or display scale. */
export async function startZoomViewport(): Promise<() => void> {
  if (!isTauri()) return () => {}
  const style = document.documentElement.style
  const apply = (level: number) => style.setProperty("--window-zoom-correction", String(1 / level))
  apply(zoomStore.getState().level)
  return zoomStore.subscribe((next, previous) => {
    if (next.level !== previous.level) apply(next.level)
  })
}
