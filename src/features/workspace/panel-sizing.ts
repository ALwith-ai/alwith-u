// Reduced from Desktop's atlas-sizing.ts; navigation is already outside this viewport.
const MIN_CHAT_WIDTH = 320

export function resolvePanelWidths(
  viewportWidth: number,
  previewVisible: boolean,
  previewWidth: number,
  fullViewportWidth = viewportWidth,
  manuallySeparated = false
): { chat: number; preview: number } {
  const screen = Math.max(0, viewportWidth)
  const full = Math.max(MIN_CHAT_WIDTH, screen)
  if (!previewVisible) return { chat: full, preview: 0 }
  const requested = Math.max(400, previewWidth || Math.floor(screen / 2))
  const pushedToNextScreen = previewWidth > 0 && previewWidth < 400
  if (!manuallySeparated && !pushedToNextScreen && screen - requested >= MIN_CHAT_WIDTH)
    return { chat: screen - requested, preview: requested }
  return { chat: full, preview: Math.max(MIN_CHAT_WIDTH, fullViewportWidth) }
}
