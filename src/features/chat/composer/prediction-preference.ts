import { createStore } from "zustand/vanilla"

import { savePreference } from "@/lib/preferences"

export const predictionPreference = createStore(() => ({ enabled: true }))

export async function setPredictionsEnabled(enabled: boolean): Promise<void> {
  await savePreference("composerPredictions", enabled)
  predictionPreference.setState({ enabled })
}
