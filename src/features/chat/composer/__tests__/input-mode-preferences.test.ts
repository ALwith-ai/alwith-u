import { DEFAULT_IMAGE_SELECTION, type ImageSelection } from "@alwith/module-chat/image"
import { beforeEach, expect, test, vi } from "vitest"

import {
  copySessionInputPreferences,
  deleteSessionInputMode,
  readSessionImageSelection,
  readSessionInputMode,
  saveSessionImageSelection,
  saveSessionInputMode
} from "../input-mode-preferences"

const native = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn()
}))
vi.mock("@/lib/store", () => ({ openStore: () => native }))
const selection: ImageSelection = { model: "doubao-seedream-5-0-pro-260628", size: "2K" }

beforeEach(() => {
  vi.resetAllMocks()
  native.values.clear()
  native.get.mockImplementation((id: string) => Promise.resolve(native.values.get(id)))
  native.set.mockImplementation((id: string, value: unknown) => {
    native.values.set(id, value)
    return Promise.resolve()
  })
  native.delete.mockImplementation((id: string) => {
    native.values.delete(id)
    return Promise.resolve()
  })
})

test("session input preferences restore independently and deletion removes the whole record", async () => {
  await saveSessionInputMode("first", "image", selection)
  await saveSessionInputMode("second", "image", DEFAULT_IMAGE_SELECTION)
  expect(await readSessionInputMode("first")).toBe("image")
  expect(await readSessionImageSelection("first")).toEqual(selection)
  expect(await readSessionImageSelection("second")).toEqual(DEFAULT_IMAGE_SELECTION)
  await deleteSessionInputMode("first")
  expect(native.values.has("first")).toBe(false)
  expect(await readSessionImageSelection("first")).toBeUndefined()
  expect(await readSessionImageSelection("second")).toEqual(DEFAULT_IMAGE_SELECTION)
})

test("legacy mode records remain readable and selecting a model upgrades them without changing mode", async () => {
  native.values.set("legacy", "image")
  expect(await readSessionInputMode("legacy")).toBe("image")
  expect(await readSessionImageSelection("legacy")).toBeUndefined()
  await saveSessionImageSelection("legacy", selection)
  expect(await readSessionInputMode("legacy")).toBe("image")
  expect(await readSessionImageSelection("legacy")).toEqual(selection)
})

test("fork preferences preserve the source mode and image model independently", async () => {
  await saveSessionInputMode("source", "image", selection)
  await copySessionInputPreferences("source", "fork")
  await saveSessionImageSelection("source", DEFAULT_IMAGE_SELECTION)
  expect(await readSessionInputMode("fork")).toBe("image")
  expect(await readSessionImageSelection("fork")).toEqual(selection)
  await deleteSessionInputMode("source")
  expect(await readSessionImageSelection("fork")).toEqual(selection)
})

test.each([
  { model: "unknown", size: "2K" },
  { ...selection, size: "invalid" }
])("invalid persisted image selections fail at the storage boundary: %j", async (invalid) => {
  native.values.set("invalid", { mode: "image", selection: invalid })
  await expect(readSessionImageSelection("invalid")).rejects.toThrow()
})
