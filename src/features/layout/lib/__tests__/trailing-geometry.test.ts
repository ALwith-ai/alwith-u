import { expect, test } from "vitest"

import { resolveMainCanvasGeometry } from "../canvas-geometry"

test.each([true, false])("the lounge exposes exactly its width after chat with pinned=%s", (pinned) => {
  const geometry = resolveMainCanvasGeometry({ viewport: 1200, navigation: 248, pinned, chat: 0, preview: 0 }, true)
  expect(geometry.regions).toEqual(["leading", "chat", "trailing"])
  expect(geometry.stops[2] - geometry.stops[1]).toBe(248)
  expect(geometry.split).toBe(false)
})

test("the lounge stays after the preview without becoming a preview split", () => {
  const geometry = resolveMainCanvasGeometry(
    { viewport: 1200, navigation: 248, pinned: true, chat: 952, preview: 1200 },
    true
  )
  expect(geometry.regions).toEqual(["leading", "chat", "preview", "trailing"])
  expect(geometry.stops).toEqual([0, 952, 2152, 2400])
  expect(geometry.split).toBe(true)
})

test("hosts without a trailing board retain their original stops", () => {
  expect(
    resolveMainCanvasGeometry({ viewport: 1200, navigation: 248, pinned: true, chat: 0, preview: 0 }, false).stops
  ).toEqual([0, 952])
})
