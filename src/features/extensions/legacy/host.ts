import "./styles.css"
import { assertPluginSessionArchiveAllowed } from "@/features/drive/plugin-bridge"
import type { Json } from "@alwith/module-extension"
import type { CapabilityBinding, CapabilityProvider } from "@alwith/module-extension/host"
import type { LegacyHost, LegacyStorage } from "@alwith/module-extension/legacy"
import type { PluginHost } from "@alwith/module-extension/plugin"
import type { Installation } from "@alwith/module-extension/tauri"
import { invoke } from "@tauri-apps/api/core"
import { emit, listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import i18n from "@/lib/i18n"
import { openExternal } from "@/lib/open"
import { client } from "@/lib/client"
import { commonCapabilities } from "../capabilities/common"
import { legacyMessageSkills } from "./adapters"
import { createLegacyBridge } from "./bridge"
import { createPluginEvents } from "./events"
import { extensionNavigation } from "../chat/navigation"
import { LEGACY_SOURCE } from "./profiles"
import { createBusinessSharing, type BusinessSharing } from "./business-sharing"

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
  let sharing: BusinessSharing | undefined
  const business = imported && primary && (id === "bi-metrics" || id === "yup-kb")
  const reportSharing = (error: unknown): void => {
    if (!binding.cancellation.aborted)
      notices.show(`业务技能数据共享失败：${error instanceof Error ? error.message : String(error)}`, 8000)
  }
  const historyAbort = new AbortController()
  binding.own(() => historyAbort.abort())
  const historyErrors = new Set<string>()
  const readHistory = async <T>(read: () => Promise<T>): Promise<T> => {
    try {
      return await read()
    } catch (error) {
      if (!binding.cancellation.aborted) {
        const message = error instanceof Error ? error.message : String(error)
        if (!historyErrors.has(message)) {
          historyErrors.add(message)
          notices.show(`会话归档未完成：${message}`, 8000)
        }
      }
      throw error
    }
  }
  return {
    ...createLegacyBridge(id, {
      binding,
      imported,
      native: invoke,
      primary,
      ...(business
        ? {
            bindBusinessStorage: (storage: LegacyStorage) => {
              const active = createBusinessSharing(
                storage,
                (file, value) => invoke("legacy_share_business", { extensionId: id, file, value }),
                changed => listen("extension://changed", changed),
                reportSharing,
                id === "yup-kb"
              )
              sharing = active
              void active.flush().catch(reportSharing)
              return async () => {
                if (sharing === active) sharing = undefined
                await active.dispose()
              }
            },
            ...(id === "yup-kb"
              ? {
                  shareCurrent: async (value: Json | null): Promise<void> => {
                    if (!sharing) throw new Error("业务技能数据共享尚未就绪")
                    await sharing.current(value)
                  }
                }
              : {})
          }
        : {}),
      history: primary
        ? {
            list: () =>
              readHistory(() => {
                if (imported && id === "yup-kb") assertPluginSessionArchiveAllowed()
                return client.listHistorySessions(() => {
                  binding.cancellation.throwIfAborted()
                  if (imported && id === "yup-kb") assertPluginSessionArchiveAllowed()
                })
              }),
            read: sessionId =>
              readHistory(() =>
                client.exportHistory(
                  sessionId,
                  () => {
                    binding.cancellation.throwIfAborted()
                    if (imported && id === "yup-kb") assertPluginSessionArchiveAllowed()
                  },
                  historyAbort.signal
                )
              ),
            check: () => binding.cancellation.throwIfAborted()
          }
        : undefined,
      check: () => binding.cancellation.throwIfAborted(),
      own: binding.own,
      session: () => (primary ? extensionNavigation().currentSession() : null),
      send: async (sessionId, text) => {
        await sharing?.flush()
        return extensionNavigation().send(sessionId, text, legacyMessageSkills(id, text), () =>
          binding.cancellation.throwIfAborted()
        )
      },
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
