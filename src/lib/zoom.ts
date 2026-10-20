// App-wide zoom, reduced from ALwith Desktop's zoom store (View → Zoom In / Out / Actual
// Size, Chrome and VS Code steps). Windows share the level through preferences.json.
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { createStore } from "zustand/vanilla"

import { savePreference } from "@/lib/preferences"

export const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0] as const
const DEFAULT_LEVEL = 1

function clampToStep(level: number): number {
  if (!Number.isFinite(level)) throw new Error("Zoom level must be finite")
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

export const zoomStore = createStore<{ level: number; interaction: number }>(() => ({
  level: DEFAULT_LEVEL,
  interaction: 0
}))

let pending = Promise.resolve()
let appliedLevel = DEFAULT_LEVEL
let revision = 0

function apply(level: number, local: boolean): Promise<void> {
  const request = ++revision
  zoomStore.setState((state) => ({ level, interaction: state.interaction + (local ? 1 : 0) }))
  // Keep rapid key presses, native zoom and preference broadcasts in the same order.
  const operation = pending
    .then(async () => {
      await getCurrentWebviewWindow().setZoom(level)
      appliedLevel = level
      if (local) await savePreference("zoomLevel", level === DEFAULT_LEVEL ? null : level)
    })
    .catch((error: unknown) => {
      if (request === revision) zoomStore.setState({ level: appliedLevel })
      throw error
    })
  // Report this operation to its caller, while allowing the next operation to proceed.
  pending = operation.catch(() => {})
  return operation
}

export function setZoomLevel(level: number): Promise<void> {
  return apply(clampToStep(level), true)
}

/** Other windows follow without opening feedback or writing the preference again. */
export function syncZoomLevel(level: number): Promise<void> {
  return apply(clampToStep(level), false)
}

export function zoomIn(): Promise<void> {
  const index = stepIndex(zoomStore.getState().level)
  return setZoomLevel(ZOOM_LEVELS[Math.min(index + 1, ZOOM_LEVELS.length - 1)])
}

export function zoomOut(): Promise<void> {
  const index = stepIndex(zoomStore.getState().level)
  return setZoomLevel(ZOOM_LEVELS[Math.max(index - 1, 0)])
}

export function resetZoom(): Promise<void> {
  return setZoomLevel(DEFAULT_LEVEL)
}

/** Boot: apply the saved level to the webview. */
export async function hydrateZoom(saved: number | null): Promise<void> {
  const level = saved === null ? DEFAULT_LEVEL : clampToStep(saved)
  zoomStore.setState({ level })
  if (level !== DEFAULT_LEVEL) await getCurrentWebviewWindow().setZoom(level)
  appliedLevel = level
}
