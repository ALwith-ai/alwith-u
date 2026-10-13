// Reduced from Desktop's atlas-sizing.ts; navigation is already outside this viewport.
export const MIN_CHAT_WIDTH = 320

export function resolvePanelWidths(
  viewportWidth: number,
  previewVisible: boolean,
  previewWidth: number
): { chat: number; preview: number } {
  const screen = Math.max(0, viewportWidth)
  const full = Math.max(MIN_CHAT_WIDTH, screen)
  if (!previewVisible) return { chat: full, preview: 0 }
  if (previewWidth === 0) return { chat: screen / 2, preview: screen / 2 }
  const requested = Math.min(screen, Math.max(0, previewWidth))
  return { chat: screen - requested, preview: requested }
}
