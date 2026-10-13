import { exceedsImageLimit, MAX_TOTAL_IMAGE_BYTES } from "@alwith/module-chat/limits"
import { expect, test } from "vitest"

test("the image budget includes the advertised limit and preserves aggregate accounting", () => {
  expect(exceedsImageLimit(0, MAX_TOTAL_IMAGE_BYTES - 1)).toBe(false)
  expect(exceedsImageLimit(0, MAX_TOTAL_IMAGE_BYTES)).toBe(false)
  expect(exceedsImageLimit(0, MAX_TOTAL_IMAGE_BYTES + 1)).toBe(true)
  expect(exceedsImageLimit(MAX_TOTAL_IMAGE_BYTES - 1, 1)).toBe(false)
  expect(exceedsImageLimit(MAX_TOTAL_IMAGE_BYTES - 1, 2)).toBe(true)
})
