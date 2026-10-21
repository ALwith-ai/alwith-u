import { useSyncExternalStore } from "react"

import { settingsStore, updateSettings } from "./settings-store"

const preferenceKey = "appearance.threeFingerSwipe"

export function trackpadPlatform(): "mac" | "windows" | "unsupported" {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform
  if (/mac/i.test(platform)) return "mac"
  if (/win/i.test(platform)) return "windows"
  return "unsupported"
}

function readEnabled(): boolean {
  const value = settingsStore.get<unknown>(preferenceKey)
  if (value !== undefined && typeof value !== "boolean") throw new Error("Invalid three-finger swipe preference")
  return trackpadPlatform() !== "unsupported" && value === true
}

function subscribe(listener: () => void): () => void {
  return settingsStore.subscribe((keys) => {
    if (keys.includes(preferenceKey)) listener()
  })
}

/** Settings bootstrap and native change broadcasts keep this projection current in every window. */
export function useThreeFingerSwipeEnabled(): boolean {
  return useSyncExternalStore(subscribe, readEnabled)
}

export async function setThreeFingerSwipeEnabled(enabled: boolean): Promise<void> {
  await updateSettings({ [preferenceKey]: enabled })
}
