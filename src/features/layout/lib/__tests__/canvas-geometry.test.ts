import { expect, test } from "vitest"
import { resolveCanvasGeometry, resolveReleaseSnap } from "../canvas-geometry"

test("a pinned sidebar is shared by leading and chat, never a separate stop", () => {
  expect(resolveCanvasGeometry({ viewport: 1200, navigation: 240, pinned: true, chat: 560, preview: 400 })).toEqual({
    leading: 960,
    main: 960,
    content: 960,
    stops: [0, 960]
  })
})
test("floating navigation takes no chat space and overflowing preview has its own stop", () => {
  expect(resolveCanvasGeometry({ viewport: 1200, navigation: 240, pinned: false, chat: 1200, preview: 1200 })).toEqual({
    leading: 960,
    main: 1200,
    content: 2400,
    stops: [0, 1200, 2400]
  })
})
test("pinned overflow accounts for navigation only on the first work screen", () => {
  expect(
    resolveCanvasGeometry({ viewport: 900, navigation: 240, pinned: true, chat: 660, preview: 900 }).stops
  ).toEqual([0, 660, 1560])
})
test("release uses the nearest screen before the fifteen percent flick rule", () => {
  const base = { startIndex: 1, snapPoints: [960, 0, -1200], viewportWidth: 1200 }
  expect(resolveReleaseSnap({ ...base, displacement: -179, location: -179 })).toBe(1)
  expect(resolveReleaseSnap({ ...base, displacement: -180, location: -180 })).toBe(2)
  expect(resolveReleaseSnap({ ...base, displacement: 180, location: 180 })).toBe(0)
  expect(resolveReleaseSnap({ ...base, displacement: -650, location: -650 })).toBe(2)
  expect(resolveReleaseSnap({ ...base, startIndex: 2, displacement: -600, location: -1800 })).toBe(2)
})
test("release also follows RTL coordinates and one-screen layouts", () => {
  expect(
    resolveReleaseSnap({
      startIndex: 1,
      snapPoints: [-960, 0, 1200],
      viewportWidth: 1200,
      displacement: 180,
      location: 180
    })
  ).toBe(2)
  expect(
    resolveReleaseSnap({ startIndex: 0, snapPoints: [0], viewportWidth: 1200, displacement: 300, location: 300 })
  ).toBe(0)
})
