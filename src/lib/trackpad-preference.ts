import { useSyncExternalStore } from "react"

import { settingsStore, updateSettings } from "./settings-store"

const masterKey = "appearance.trackpadEnabled"

const preferenceKey = "appearance.threeFingerSwipe"

export function trackpadPlatform(): "mac" | "windows" | "unsupported" {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform
  if (/mac/i.test(platform)) return "mac"
  if (/win/i.test(platform)) return "windows"
  return "unsupported"
}

function readGesture(): boolean {
  const value = settingsStore.get<unknown>(preferenceKey)
  if (value !== undefined && typeof value !== "boolean") throw new Error("Invalid three-finger swipe preference")
  return trackpadPlatform() !== "unsupported" && value === true
}

function subscribe(listener: () => void): () => void {
  return settingsStore.subscribe((keys) => {
    if (keys.includes(preferenceKey) || keys.includes(masterKey)) listener()
  })
}

function readMaster(): boolean {
  const value = settingsStore.get<unknown>(masterKey)
  if (value !== undefined && typeof value !== "boolean") throw new Error("Invalid trackpad preference")
  return trackpadPlatform() !== "unsupported" && value === true
}

function readEnabled(): boolean {
  return readMaster() && readGesture()
}

export function useTrackpadEnabled(): boolean {
  return useSyncExternalStore(subscribe, readMaster)
}

export function useThreeFingerSwipeSelected(): boolean {
  return useSyncExternalStore(subscribe, readGesture)
}

export async function setTrackpadEnabled(enabled: boolean): Promise<void> {
  await updateSettings({ [masterKey]: enabled })
}

/** Settings bootstrap and native change broadcasts keep this projection current in every window. */
export function useThreeFingerSwipeEnabled(): boolean {
  return useSyncExternalStore(subscribe, readEnabled)
}

export async function setThreeFingerSwipeEnabled(enabled: boolean): Promise<void> {
  await updateSettings({ [preferenceKey]: enabled })
}
