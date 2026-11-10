import { expect, test } from "vitest"

import { chatInputMode } from "../input-modes/chat"
import { imageInputMode } from "../input-modes/image"

test("the host constructs image policy without changing the user message", () => {
  expect(imageInputMode.nativeTools).toEqual({ imageGeneration: false })
  expect(imageInputMode.applicationContext("edit", "Custom workflow")["alwith.imageIntent"]).toContain(
    "Custom workflow"
  )
  expect(imageInputMode.applicationContext("generate")["alwith.imageIntent"]).toContain(
    "application generate_image tool"
  )
  expect(() => imageInputMode.applicationContext("unknown")).toThrow("Invalid image intent")
})

test("chat replaces previous image instructions with native routing", () => {
  expect(chatInputMode.nativeTools).toEqual({})
  expect(chatInputMode.applicationContext()["alwith.imageIntent"]).toContain("use the native image generation tool")
  expect(chatInputMode.applicationContext()["alwith.imageIntent"]).not.toContain("Custom workflow")
})
