import { expect, test } from "vitest"

import { advanceLoadingProgress } from "../../../../node_modules/@alwith/module-auth/dist/pets/core/lib/loading-progress.js"

function advance(real: number, seconds: number, displayed = 0): number {
  for (let frame = 0; frame < seconds * 60; frame++) {
    displayed = advanceLoadingProgress(displayed, real, 1 / 60)
  }
  return displayed
}

test("keeps moving when resources stall at 45%, slowing after 80%", () => {
  expect(advance(0, 0.8)).toBeCloseTo(0.8, 3)
  const first = advance(0.45, 1)
  const second = advance(0.45, 2)
  expect(first).toBeGreaterThan(0.8)
  expect(second).toBeGreaterThan(first)
  expect(second - first).toBeLessThan(0.1)
  expect(advance(0.45, 60)).toBeLessThanOrEqual(0.99)
})

test("does not regress when the resource total increases and finishes only when ready", () => {
  expect(advanceLoadingProgress(0.9, 0.2, 1 / 60)).toBeGreaterThan(0.9)
  expect(advance(0.9999, 60)).toBeLessThanOrEqual(0.99)
  expect(advance(1, 1, 0.9)).toBe(1)
  expect(advanceLoadingProgress(0.2, 1, 10)).toBe(1)
})
