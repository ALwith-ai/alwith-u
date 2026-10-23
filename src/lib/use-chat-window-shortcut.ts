import { useSyncExternalStore } from "react"

import { settingsStore } from "./settings-store"

const subscribe = (listener: () => void) => settingsStore.subscribe(listener)
const getSnapshot = () => settingsStore.get<string>("chat.windowShortcut") ?? "Alt+Space"

export function useChatWindowShortcut(): string {
  return useSyncExternalStore(subscribe, getSnapshot)
}
