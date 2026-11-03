import { DEFAULT_IMAGE_SELECTION, type ImageSelection } from "@alwith/module-chat/image"
import { beforeEach, expect, test, vi } from "vitest"

import { saveImageSelection, useImagePreferences, watchImagePreferences } from "../preferences"

const native = vi.hoisted(() => ({
  configured: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  onKeyChange: vi.fn(),
  stop: vi.fn(),
  receive: null as ((value: ImageSelection | undefined) => void) | null
}))
vi.mock("@/bindings", () => ({ commands: { imagesConfigured: native.configured } }))
vi.mock("@/lib/store", () => ({ openStore: () => native }))
const seedream: ImageSelection = { model: "doubao-seedream-5-0-lite-260128", size: "2K" }
const pro: ImageSelection = { model: "doubao-seedream-5-0-pro-260628", size: "1K" }

beforeEach(() => {
  vi.resetAllMocks()
  useImagePreferences.setState({ selection: DEFAULT_IMAGE_SELECTION, seedreamConfigured: null })
  native.configured.mockResolvedValue(true)
  native.receive = null
  native.get.mockResolvedValue(seedream)
  native.set.mockResolvedValue(undefined)
  native.onKeyChange.mockImplementation(async (_key, receive) => {
    native.receive = receive
    return native.stop
  })
})

test("every window restores and follows the native image selection, including a reset", async () => {
  const stop = await watchImagePreferences()
  expect(useImagePreferences.getState().selection).toEqual(seedream)
  native.receive!(pro)
  expect(useImagePreferences.getState().selection).toEqual(pro)
  native.receive!(undefined)
  expect(useImagePreferences.getState().selection).toEqual(DEFAULT_IMAGE_SELECTION)
  stop()
  expect(native.stop).toHaveBeenCalledOnce()
})

test("a late initial read cannot overwrite a newer selection from another window", async () => {
  const read = Promise.withResolvers<ImageSelection>()
  native.get.mockReturnValueOnce(read.promise)
  const watching = watchImagePreferences()
  await vi.waitFor(() => expect(native.get).toHaveBeenCalled())
  native.receive!(pro)
  read.resolve(seedream)
  const stop = await watching
  expect(useImagePreferences.getState().selection).toEqual(pro)
  stop()
})

test("a late save acknowledgement keeps a newer native selection and failed saves keep the current choice", async () => {
  const stop = await watchImagePreferences()
  const saved = Promise.withResolvers<void>()
  native.set.mockReturnValueOnce(saved.promise)
  const saving = saveImageSelection(DEFAULT_IMAGE_SELECTION)
  native.receive!(pro)
  saved.resolve()
  await saving
  expect(useImagePreferences.getState().selection).toEqual(pro)
  native.set.mockRejectedValueOnce(new Error("Cannot save selection"))
  await expect(saveImageSelection(seedream)).rejects.toThrow("Cannot save selection")
  expect(useImagePreferences.getState().selection).toEqual(pro)
  await saveImageSelection(seedream)
  expect(useImagePreferences.getState().selection).toEqual(seedream)
  stop()
})

test("invalid persisted models fail explicitly and release the native listener", async () => {
  native.get.mockResolvedValueOnce({ model: "missing-model", size: "auto" })
  await expect(watchImagePreferences()).rejects.toThrow()
  expect(native.stop).toHaveBeenCalledOnce()
  expect(useImagePreferences.getState().selection).toEqual(DEFAULT_IMAGE_SELECTION)
})
