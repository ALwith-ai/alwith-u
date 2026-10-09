import "./styles.css"
import type { CapabilityBinding, CapabilityProvider } from "@alwith/module-extension/host"
import type { LegacyHost } from "@alwith/module-extension/legacy"
import type { PluginHost } from "@alwith/module-extension/plugin"
import type { Installation } from "@alwith/module-extension/tauri"
import { invoke } from "@tauri-apps/api/core"
import { emit, listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import i18n from "@/lib/i18n"
import { openExternal } from "@/lib/open"
import { commonCapabilities } from "../capabilities/common"
import { legacyMessageSkills } from "./adapters"
import { createLegacyBridge } from "./bridge"
import { createPluginEvents } from "./events"
import { extensionNavigation } from "../chat/navigation"
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
      return createHost(binding, true)
    }
  }
}

/** Formal plugins use common capabilities; legacy import certificates remain mandatory for old packages. */
export function createPluginHost(): CapabilityProvider<PluginHost> {
  return { version: "1.0.0", create: binding => createHost(binding, false) }
}

function createHost(
  binding: CapabilityBinding,
  imported: boolean
): LegacyHost & { events: ReturnType<typeof createPluginEvents> } {
  const id = binding.manifest.id
  const primary = getCurrentWindow().label === "main"
  const clipboard = commonCapabilities.clipboard.create(binding)
  const notices = commonCapabilities.notices.create(binding)
  return {
    ...createLegacyBridge(id, {
      binding,
      imported,
      native: invoke,
      primary,
      check: () => binding.cancellation.throwIfAborted(),
      own: binding.own,
      session: () => (primary ? extensionNavigation().currentSession() : null),
      send: (sessionId, text) =>
        extensionNavigation().send(sessionId, text, legacyMessageSkills(id, text), () =>
          binding.cancellation.throwIfAborted()
        ),
      setDraft: (sessionId, text) =>
        extensionNavigation().setDraft(sessionId, text, legacyMessageSkills(id, text), () =>
          binding.cancellation.throwIfAborted()
        ),
      openView: viewId => extensionNavigation().openView(viewId),
      language: () => i18n.resolvedLanguage ?? i18n.language,
      openExternal,
      clipboard: text => clipboard.writeText(text),
      notify: (message, duration) => notices.show(message, duration)
    }),
    events: createPluginEvents(id, binding, {
      listen: (event, callback) => listen(event, message => callback(message.payload)),
      emit: (event, payload) => emit(event, payload)
    })
  }
}
