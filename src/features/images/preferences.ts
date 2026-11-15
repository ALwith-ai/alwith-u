import { createImagePreferences } from "@alwith/module-media"
import { toast } from "sonner"

import { openStore } from "@/lib/store"

export { selectableImageModels } from "@alwith/module-media"

const preferences = createImagePreferences(openStore("image-preferences"))
export const imagePreferences = preferences
export const { useImagePreferences, saveImageSelection } = preferences

const reportError = (error: unknown) => toast.error(String(error))
/** The main ACP owner and floating composer observe the same native preference changes. */
export function useImagePreferenceSync(): void {
  preferences.useImagePreferenceSync(reportError)
}
