import "./styles.css"
import type { CapabilityProvider } from "@alwith/module-extension/host"
import type { LegacyHost } from "@alwith/module-extension/legacy"
import type { Installation } from "@alwith/module-extension/tauri"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import i18n from "@/lib/i18n"
import { openExternal } from "@/lib/open"
import { commonCapabilities } from "../capabilities/common"
import { legacyMessageSkills } from "./adapters"
import { createLegacyBridge } from "./bridge"
import { legacyNavigation } from "./navigation"
import { LEGACY_SOURCE } from "./profiles"

export function createLegacyHost(
  installation: (id: string) => Installation | undefined
): CapabilityProvider<LegacyHost> {
  return {
    version: "1.0.0",
    create(binding) {
      const id = binding.manifest.id
      if (installation(id)?.source !== LEGACY_SOURCE)
        throw new Error("请从本地目录安装原始 Desktop 扩展，由宿主自动生成兼容包")
      const primary = getCurrentWindow().label === "main"
      const clipboard = commonCapabilities.clipboard.create(binding)
      const notices = commonCapabilities.notices.create(binding)
      return createLegacyBridge(id, {
        binding,
        native: invoke,
        primary,
        check: () => binding.cancellation.throwIfAborted(),
        own: binding.own,
        session: () => (primary ? legacyNavigation().currentSession() : null),
        send: (sessionId, text) => legacyNavigation().send(sessionId, text, legacyMessageSkills(id, text)),
        openView: viewId => legacyNavigation().openView(viewId),
        language: () => i18n.resolvedLanguage ?? i18n.language,
        openExternal,
        clipboard: text => clipboard.writeText(text),
        notify: (message, duration) => notices.show(message, duration)
      })
    }
  }
}
