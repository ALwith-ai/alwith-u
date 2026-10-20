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

test("opening a workspace splits even narrow viewports equally", () => {
  expect(resolvePanelWidths(720, true, 0)).toEqual({ chat: 360, preview: 360 })
  expect(resolvePanelWidths(719, true, 0)).toEqual({ chat: 359.5, preview: 359.5 })
})

test("dragged panels stay within the viewport", () => {
  expect(resolvePanelWidths(720, true, 400)).toEqual({ chat: 320, preview: 400 })
  expect(resolvePanelWidths(1200, true, 881)).toEqual({ chat: 319, preview: 881 })
  expect(resolvePanelWidths(1200, true, 1300)).toEqual({ chat: 0, preview: 1200 })
})

test("hiding preview gives chat the whole viewport", () => {
  expect(resolvePanelWidths(1200, false, 700)).toEqual({ chat: 1200, preview: 0 })
  expect(resolvePanelWidths(280, false, 0)).toEqual({ chat: 320, preview: 0 })
})
