export type QuickChatSide = "left" | "right"
export type QuickChatEdge = "top" | "bottom"
export interface Size {
  width: number
  height: number
}
export interface Point {
  x: number
  y: number
}
export const quickChatDefault: Size = { width: 560, height: 640 }
const quickChatInset = 16

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export function quickChatSize(size: Size, container: Size): Size {
  const width = Math.max(0, container.width - quickChatInset * 2)
  const height = Math.max(0, container.height - quickChatInset * 2)
  return {
    width: clamp(size.width, Math.min(360, width), width),
    height: clamp(size.height, Math.min(400, height), height)
  }
}

export function quickChatAnchor(
  side: QuickChatSide,
  size: Size,
  container: Size,
  edge: QuickChatEdge = "bottom"
): Point {
  return {
    x: side === "left" ? quickChatInset : Math.max(quickChatInset, container.width - size.width - quickChatInset),
    y: edge === "top" ? quickChatInset : Math.max(quickChatInset, container.height - size.height - quickChatInset)
  }
}

export function nearestQuickChatSide(point: Point, size: Size, container: Size): QuickChatSide {
  const left = quickChatAnchor("left", size, container)
  const right = quickChatAnchor("right", size, container)
  return Math.abs(point.x - left.x) < Math.abs(point.x - right.x) ? "left" : "right"
}

export function nearestQuickChatCorner(point: Point, size: Size, container: Size) {
  const top = quickChatAnchor("left", size, container, "top")
  const bottom = quickChatAnchor("left", size, container, "bottom")
  return {
    side: nearestQuickChatSide(point, size, container),
    edge: (Math.abs(point.y - top.y) < Math.abs(point.y - bottom.y) ? "top" : "bottom") as QuickChatEdge
  }
}

export function resizeQuickChat(
  start: Size,
  delta: Point,
  side: QuickChatSide,
  container: Size,
  edge: QuickChatEdge = "bottom"
): Size {
  return quickChatSize(
    {
      width: start.width + (side === "left" ? delta.x : -delta.x),
      height: start.height + (edge === "top" ? delta.y : -delta.y)
    },
    container
  )
}
