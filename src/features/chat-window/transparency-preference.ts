import { createStore } from "zustand/vanilla"

import { savePreference } from "@/lib/preferences"

export const chatWindowTransparency = createStore(() => ({ transparent: true }))

export async function setChatWindowTransparent(transparent: boolean): Promise<void> {
  await savePreference("chatWindowTransparent", transparent)
  chatWindowTransparency.setState({ transparent })
}
