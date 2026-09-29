import type { CapabilityProvider } from "@alwith/module-extension/host"
import type { Installation } from "@alwith/module-extension/tauri"
import { authorizeCapability } from "../policy"
import { createWallpaperCapability } from "./wallpaper"
import { wallpaperCapability } from "./wallpaper-contract"

export function createHostCapabilities(
  installation: (id: string) => Installation | undefined,
  reportError: (error: unknown) => void
): Record<string, CapabilityProvider> {
  const providers: Record<string, CapabilityProvider> = {
    [wallpaperCapability.id]: createWallpaperCapability(reportError)
  }
  return Object.fromEntries(
    Object.entries(providers).map(([id, provider]) => [id, authorizeCapability(id, provider, installation)])
  )
}
