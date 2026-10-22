// Adapted from Desktop's Atlas sizing and release policy.
export function resolveCanvasGeometry(input: {
  viewport: number
  navigation: number
  pinned: boolean
  chat: number
  preview: number
}): { leading: number; main: number; content: number; stops: number[] } {
  const { viewport, navigation, pinned, chat, preview } = input
  const leading = Math.max(0, viewport - navigation)
  const main = leading + (pinned ? 0 : navigation)
  const budget = Math.max(0, viewport - (pinned ? navigation : 0))
  const content = Math.max(budget, chat + preview)
  const stops = [0, main]
  if (chat > 0 && preview > 0 && chat + preview > budget) stops.push(leading + navigation + chat)
  return { leading, main, content, stops }
}

export function resolveReleaseSnap(input: {
  startIndex: number
  displacement: number
  location: number
  snapPoints: readonly number[]
  viewportWidth: number
}): number {
  const { startIndex, displacement, location, snapPoints, viewportWidth } = input
  if (snapPoints.length === 0) throw new Error("Canvas has no snap points")
  if (snapPoints.length === 1) return 0
  let nearest = 0
  for (let i = 1; i < snapPoints.length; i++) {
    if (Math.abs(snapPoints[i] - location) < Math.abs(snapPoints[nearest] - location)) nearest = i
  }
  if (nearest !== startIndex) return nearest
  if (Math.abs(displacement) < viewportWidth * 0.15) return startIndex
  const direction =
    startIndex < snapPoints.length - 1
      ? snapPoints[startIndex + 1] - snapPoints[startIndex]
      : snapPoints[startIndex] - snapPoints[startIndex - 1]
  return Math.max(0, Math.min(snapPoints.length - 1, startIndex + (displacement * direction > 0 ? 1 : -1)))
}
