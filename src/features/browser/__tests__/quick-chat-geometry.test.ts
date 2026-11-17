import { expect, test } from "vitest"

import {
  nearestQuickChatCorner,
  nearestQuickChatSide,
  quickChatAnchor,
  quickChatSize,
  resizeQuickChat
} from "../quick-chat-geometry"

const container = { width: 1200, height: 800 }
const size = { width: 560, height: 640 }
test("release always chooses a side, including the middle of the browser", () => {
  expect(nearestQuickChatSide({ x: 40, y: 20 }, size, container)).toBe("left")
  expect(nearestQuickChatSide({ x: 600, y: 20 }, size, container)).toBe("right")
  expect(nearestQuickChatSide({ x: 320, y: 20 }, size, container)).toBe("right")
  expect(quickChatAnchor("left", size, container)).toEqual({ x: 16, y: 144 })
  expect(quickChatAnchor("right", size, container)).toEqual({ x: 624, y: 144 })
})
test("resizing keeps the docked edge and bottom stable", () => {
  const bigger = resizeQuickChat(size, { x: -80, y: -40 }, "right", container)
  expect(bigger).toEqual({ width: 640, height: 680 })
  const before = quickChatAnchor("right", size, container)
  const after = quickChatAnchor("right", bigger, container)
  expect(after.x + bigger.width).toBe(before.x + size.width)
  expect(after.y + bigger.height).toBe(before.y + size.height)
  expect(resizeQuickChat(size, { x: 80, y: -40 }, "left", container)).toEqual(bigger)
})
test("narrow and short containers keep the full surface reachable", () => {
  expect(quickChatSize(size, { width: 300, height: 240 })).toEqual({ width: 268, height: 208 })
  expect(quickChatSize({ width: 1, height: 1 }, container)).toEqual({ width: 360, height: 400 })
})

test.each([
  { point: { x: 10, y: 10 }, side: "left", edge: "top" },
  { point: { x: 700, y: 10 }, side: "right", edge: "top" },
  { point: { x: 10, y: 200 }, side: "left", edge: "bottom" },
  { point: { x: 700, y: 200 }, side: "right", edge: "bottom" }
] as const)("release at $side $edge chooses that corner", ({ point, side, edge }) => {
  expect(nearestQuickChatCorner(point, size, container)).toEqual({ side, edge })
  const anchor = quickChatAnchor(side, size, container, edge)
  expect(anchor.x).toBe(side === "left" ? 16 : 624)
  expect(anchor.y).toBe(edge === "top" ? 16 : 144)
})
test("top docking grows downward and keeps its anchored corner fixed", () => {
  const bigger = resizeQuickChat(size, { x: 80, y: 40 }, "left", container, "top")
  expect(bigger).toEqual({ width: 640, height: 680 })
  expect(quickChatAnchor("left", bigger, container, "top")).toEqual({ x: 16, y: 16 })
})
