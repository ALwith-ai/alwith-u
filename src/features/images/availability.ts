import { createImageAvailability } from "@alwith/module-media"

import { client } from "@/lib/client"
import { ACCOUNT_CHANGED } from "@/lib/settings-bridge"

import { imagePreferences } from "./preferences"

export const { useImageAvailability } = createImageAvailability({
  client: () => client,
  preferences: imagePreferences,
  accountChanged: ACCOUNT_CHANGED
})
