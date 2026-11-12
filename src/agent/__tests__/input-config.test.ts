import { expect, test } from "vitest"

import { parseInputConfig, parseInputSnapshot } from "../input-config"
import { inputModeDefinition, resolveInputMode } from "../input-modes"

test("storage round-trips arbitrary mode configurations without enabling unsupported modes", () => {
  const inputConfig = { mode: "future-mode", config: { nested: [{ enabled: true, count: 3 }, null] } }
  const snapshot = parseInputSnapshot({ sessionId: "one", revision: 1, inputConfig }, "one")
  expect(snapshot.inputConfig).toEqual(inputConfig)
  expect(() => resolveInputMode(snapshot.inputConfig)).toThrow("Unsupported input mode")
})

test("storage canonicalizes JSON while mode definitions validate their own settings", () => {
  expect(JSON.stringify(parseInputConfig({ mode: "future-mode", config: { z: 1, a: 2 } }))).toBe(
    JSON.stringify(parseInputConfig({ mode: "future-mode", config: { a: 2, z: 1 } }))
  )
  const invalid = parseInputConfig({ mode: "image", config: { model: "wham", size: "4K" } })
  expect(() => resolveInputMode(invalid)).toThrow("Invalid image model or size")
  expect(() => resolveInputMode({ mode: "chat", config: { model: "wham" } })).toThrow("must be empty")
  expect(() => parseInputConfig({ mode: "future-mode", config: { value: Infinity } })).toThrow("JSON values")
  expect(() => parseInputConfig({ mode: "future-mode", config: new Date() })).toThrow("JSON values")
})

test("each mode owns tool registration and prompt routing", () => {
  const routes = { native: () => "native", image: () => "configured-image" }
  expect(inputModeDefinition("chat").routePrompt(routes)).toBe("native")
  expect(inputModeDefinition("image").routePrompt(routes)).toBe("configured-image")
})
