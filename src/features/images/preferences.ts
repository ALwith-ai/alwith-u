import { DEFAULT_IMAGE_SELECTION, IMAGE_MODELS, imageModel, type ImageSelection } from "@alwith/module-chat/image"
import { useEffect } from "react"
import { toast } from "sonner"
import { create } from "zustand"

import { commands } from "@/bindings"
import { openStore } from "@/lib/store"

const store = openStore("image-preferences")
const retiredModels = new Set(["doubao-seedream-4-5-251128"])
export const selectableImageModels = IMAGE_MODELS.filter((model) => !retiredModels.has(model.id))
export const useImagePreferences = create<{ selection: ImageSelection; seedreamConfigured: boolean | null }>(() => ({
  selection: DEFAULT_IMAGE_SELECTION,
  seedreamConfigured: null
}))
let revision = 0
let providerRequest: Promise<boolean> | null = null
function applySelection(value: ImageSelection | undefined) {
  const selection = value && !retiredModels.has(value.model) ? value : DEFAULT_IMAGE_SELECTION
  const model = imageModel(selection)
  ++revision
  useImagePreferences.setState({
    selection:
      model.provider === "seedream" && useImagePreferences.getState().seedreamConfigured === false
        ? DEFAULT_IMAGE_SELECTION
        : selection
  })
}

/** Credentials remain native; webviews only receive whether Seedream is available. */
export function refreshImageProviders(): Promise<boolean> {
  return (providerRequest ??= commands
    .imagesConfigured()
    .then((seedreamConfigured) => {
      const reset = !seedreamConfigured && imageModel(useImagePreferences.getState().selection).provider === "seedream"
      if (reset) ++revision
      useImagePreferences.setState({ seedreamConfigured, ...(reset ? { selection: DEFAULT_IMAGE_SELECTION } : {}) })
      return seedreamConfigured
    })
    .finally(() => {
      providerRequest = null
    }))
}

/** Subscribe before reading so a late startup read cannot overwrite a newer window's choice. */
export async function watchImagePreferences(): Promise<() => void> {
  const stop = await store.onKeyChange<ImageSelection>("selection", applySelection)
  const started = revision
  try {
    const [selection] = await Promise.all([store.get<ImageSelection>("selection"), refreshImageProviders()])
    if (started === revision) applySelection(selection)
    return stop
  } catch (error) {
    stop()
    throw error
  }
}
export async function saveImageSelection(selection: ImageSelection): Promise<void> {
  imageModel(selection)
  if (retiredModels.has(selection.model)) throw new Error("This image model is no longer available")
  const started = revision
  await store.set("selection", selection)
  if (started === revision) applySelection(selection)
}

/** The main ACP owner and floating composer observe the same native preference changes. */
export function useImagePreferenceSync(): void {
  useEffect(() => {
    const stop = watchImagePreferences()
    const refresh = () => void refreshImageProviders().catch((error: unknown) => toast.error(String(error)))
    window.addEventListener("focus", refresh)
    void stop.catch((error: unknown) => toast.error(String(error)))
    return () => {
      window.removeEventListener("focus", refresh)
      void stop.then(
        (unlisten) => unlisten(),
        () => undefined
      )
    }
  }, [])
}
