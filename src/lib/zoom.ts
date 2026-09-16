// App-wide zoom, reduced from ALwith Desktop's zoom store (View → Zoom In / Out / Actual
// Size, Chrome and VS Code steps). One window, so the level lives in preferences.json.
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { createStore } from "zustand/vanilla"
import { savePreference } from "@/lib/preferences"

export const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0] as const
const DEFAULT_LEVEL = 1

function clampToStep(level: number): number {
  let best: number = ZOOM_LEVELS[0]
  let bestDiff = Math.abs(level - best)
  for (const step of ZOOM_LEVELS) {
    const diff = Math.abs(level - step)
    if (diff < bestDiff) {
      best = step
      bestDiff = diff
    }
  }
  return best
}

function stepIndex(level: number): number {
  return ZOOM_LEVELS.indexOf(clampToStep(level) as (typeof ZOOM_LEVELS)[number])
}

export const zoomStore = createStore<{ level: number }>(() => ({ level: DEFAULT_LEVEL }))

async function apply(level: number): Promise<void> {
  zoomStore.setState({ level })
  await getCurrentWebviewWindow().setZoom(level)
  await savePreference("zoomLevel", level === DEFAULT_LEVEL ? null : level)
}

export function zoomIn(): Promise<void> {
  const index = stepIndex(zoomStore.getState().level)
  return apply(ZOOM_LEVELS[Math.min(index + 1, ZOOM_LEVELS.length - 1)]!)
}

export function zoomOut(): Promise<void> {
  const index = stepIndex(zoomStore.getState().level)
  return apply(ZOOM_LEVELS[Math.max(index - 1, 0)]!)
}

export function resetZoom(): Promise<void> {
  return apply(DEFAULT_LEVEL)
}

/** Boot: apply the saved level to the webview. */
export async function hydrateZoom(saved: number | null): Promise<void> {
  const level = saved === null ? DEFAULT_LEVEL : clampToStep(saved)
  zoomStore.setState({ level })
  if (level !== DEFAULT_LEVEL) await getCurrentWebviewWindow().setZoom(level)
}
