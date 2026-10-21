import { expect, test } from "vitest"

import { resolvePanelWidths } from "../panel-sizing"

test("visible panels share the viewport equally by default", () => {
  expect(resolvePanelWidths(1200, true, 0)).toEqual({ chat: 600, preview: 600 })
  expect(resolvePanelWidths(1600, true, 0)).toEqual({ chat: 800, preview: 800 })
})

test("a dragged preview keeps its pixel width as the window grows", () => {
  expect(resolvePanelWidths(1200, true, 700)).toEqual({ chat: 500, preview: 700 })
  expect(resolvePanelWidths(1600, true, 700)).toEqual({ chat: 900, preview: 700 })
})

test("narrow viewports keep readable panels on separate screens", () => {
  expect(resolvePanelWidths(720, true, 0)).toEqual({ chat: 320, preview: 400 })
  expect(resolvePanelWidths(719, true, 0)).toEqual({ chat: 719, preview: 719 })
})

test("an oversized preview moves to another screen without hiding chat", () => {
  expect(resolvePanelWidths(720, true, 400)).toEqual({ chat: 320, preview: 400 })
  expect(resolvePanelWidths(1200, true, 881)).toEqual({ chat: 1200, preview: 1200 })
  expect(resolvePanelWidths(1200, true, 1300)).toEqual({ chat: 1200, preview: 1200 })
})

test("hiding preview gives chat the whole viewport", () => {
  expect(resolvePanelWidths(1200, false, 700)).toEqual({ chat: 1200, preview: 0 })
  expect(resolvePanelWidths(280, false, 0)).toEqual({ chat: 320, preview: 0 })
})

test("shrinking preview below its minimum moves it to the next full screen", () => {
  expect(resolvePanelWidths(1000, true, 399, 1256)).toEqual({ chat: 1000, preview: 1256 })
  expect(resolvePanelWidths(1000, true, 1, 1256)).toEqual({ chat: 1000, preview: 1256 })
  expect(resolvePanelWidths(1000, true, 420, 1256)).toEqual({ chat: 580, preview: 420 })
})
