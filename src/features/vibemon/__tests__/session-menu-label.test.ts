import { expect, test } from "vitest"

import { fitSessionMenuLabel } from "../session-menu-label"

const measure = (text: string) =>
  Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)).length * 10

test("short native menu labels are preserved", () => {
  expect(fitSessionMenuLabel("独立浮窗 / project / 新对话", measure)).toBe("独立浮窗 / project / 新对话")
})

test("long menu labels fit the width budget including the ellipsis", () => {
  const result = fitSessionMenuLabel(`主窗 / project / ${"很长的会话标题".repeat(20)}`, measure)
  expect(result).toMatch(/^主窗 \/ project \/ /)
  expect(result.endsWith("…")).toBe(true)
  expect(measure(result)).toBeLessThanOrEqual(300)
})

test("truncation preserves composed emoji and combining accents", () => {
  expect(fitSessionMenuLabel("👨‍👩‍👧‍👦é🙂more", measure, 30)).toBe("👨‍👩‍👧‍👦é…")
})
