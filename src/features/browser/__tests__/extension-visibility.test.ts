import { expect, test } from "vitest"

import { loadHiddenExtensions, withShown } from "../extension-visibility"

test("a button stays in the toolbar until the user takes it out, and comes back when put back", () => {
  expect(withShown([], "a", false)).toEqual(["a"])
  expect(withShown(["a"], "a", false)).toEqual(["a"])
  expect(withShown(["a", "b"], "a", true)).toEqual(["b"])
  expect(withShown(["b"], "a", true)).toEqual(["b"])
})

test("what was hidden is read back, and anything else stored there is refused", () => {
  const stored = (value: string | null) => ({ getItem: () => value })
  expect(loadHiddenExtensions(stored(null))).toEqual([])
  expect(loadHiddenExtensions(stored('["a","b"]'))).toEqual(["a", "b"])
  expect(() => loadHiddenExtensions(stored('{"a":true}'))).toThrow()
  expect(() => loadHiddenExtensions(stored("[1]"))).toThrow()
})
