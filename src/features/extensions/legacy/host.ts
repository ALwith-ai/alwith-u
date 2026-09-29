import type { CapabilityProvider } from "@alwith/module-extension/host"
import type { LegacyHost } from "@alwith/module-extension/legacy"
import type { Installation } from "@alwith/module-extension/tauri"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { toast } from "sonner"
import i18n from "@/lib/i18n"
import { openExternal } from "@/lib/open"
import { createLegacyBridge } from "./bridge"
import { legacyNavigation } from "./navigation"
import { legacyProfile, LEGACY_SOURCE } from "./profiles"

export function createLegacyHost(
  installation: (id: string) => Installation | undefined
): CapabilityProvider<LegacyHost> {
  return {
    version: "1.0.0",
    create(binding) {
      const id = binding.manifest.id
      legacyProfile(id)
      if (installation(id)?.source !== LEGACY_SOURCE)
        throw new Error("请从本地目录安装原始 Desktop 扩展，由宿主自动生成兼容包")
      const primary = getCurrentWindow().label === "main"
      return createLegacyBridge(id, {
        native: invoke,
        primary,
        check: () => binding.cancellation.throwIfAborted(),
        own: binding.own,
        session: () => (primary ? legacyNavigation().currentSession() : null),
        send: (sessionId, text) => legacyNavigation().send(sessionId, text),
        openView: viewId => legacyNavigation().openView(viewId),
        language: () => i18n.resolvedLanguage ?? i18n.language,
        openExternal,
        clipboard: text => navigator.clipboard.writeText(text),
        notify(message, duration = 5000) {
          const notification = toast(message, { duration })
          const hide = (): void => {
            toast.dismiss(notification)
          }
          binding.own(hide)
          return {
            hide,
            setMessage: text => {
              toast(text, { id: notification, duration })
            }
          }
        }
      })
    }
  }
}
