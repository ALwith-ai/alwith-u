import type { Installation } from "@alwith/module-extension/tauri"
import { toast } from "sonner"
import { findLegacyProfile, LEGACY_SOURCE } from "./profiles"

/** Called by explicit UI actions, never by activation or background filesystem requests. */
export function showExtensionLimitations(installation: Installation | undefined): void {
  if (!installation?.enabled || installation.source !== LEGACY_SOURCE) return
  const messages = findLegacyProfile(installation.id)?.limitations ?? []
  if (!messages.length) return
  toast(messages.join("\n"), {
    id: `extension-limitations:${installation.installationId}`,
    duration: 10000,
    closeButton: true
  })
}
