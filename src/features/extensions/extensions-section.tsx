import { invoke } from "@tauri-apps/api/core"
import { ask } from "@tauri-apps/plugin-dialog"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ExtensionMount } from "./extension-view"
import { ExtensionsManager } from "./extensions-manager"
import { executePreparedInstall, type PreparedInstall } from "./install-service"
import { LEGACY_SOURCE } from "./legacy/profiles"
import { showExtensionLimitations } from "./legacy/limitations"
import { waitForLegacyUninstall } from "./legacy/uninstall"
import { reportExtensionError, useExtensions } from "./runtime"

export function ExtensionsSection({ onOpenSurface }: { onOpenSurface?(id: string): void }) {
  const { t } = useTranslation()
  const { runtime, state, host } = useExtensions()
  const [operation, setOperation] = useState(false)
  const run = (action: () => Promise<void>): void => {
    setOperation(true)
    void action()
      .catch(reportExtensionError)
      .finally(() => setOperation(false))
  }
  const busy = operation || state.busy
  const install = async (id?: string): Promise<void> => {
    const selected = await invoke<PreparedInstall | null>("extension_prepare_install", { expectedId: id ?? null })
    if (!selected) return
    const result = await executePreparedInstall(
      runtime,
      selected,
      { update: id !== undefined || selected.format === "legacy" },
      {
        stageLegacy: (ticket, converted) => invoke("legacy_stage_import", { ticket, ...converted })
      }
    )
    if (result.error) throw new Error(result.error.message)
  }
  return (
    <ExtensionsManager
      state={state}
      host={host}
      busy={busy}
      onOpenSurface={onOpenSurface}
      onInstall={id => run(() => install(id))}
      onRequest={request =>
        run(async () => {
          await runtime.request(request)
          if (request.type === "enable") {
            await runtime.settled()
            const current = runtime.snapshot()
            if (!current.errors[request.id])
              showExtensionLimitations(current.native?.installations.find(item => item.id === request.id))
          }
        })
      }
      onUninstall={(id, name) =>
        run(async () => {
          if (
            await ask(t("extensions.uninstallConfirm", { name }), { title: t("settings.extensions"), kind: "warning" })
          ) {
            const legacy =
              runtime.snapshot().native?.installations.find(item => item.id === id)?.source === LEGACY_SOURCE
            await runtime.request({ type: "beginTransition", id, action: "uninstall" })
            await waitForLegacyUninstall({
              state: () => {
                const native = runtime.snapshot().native
                if (!native) throw new Error("扩展安装状态不可用")
                return {
                  installed: native.installations.some(item => item.id === id),
                  pending: native.pending.some(item => item.id === id)
                }
              },
              subscribe: runtime.subscribe,
              cleanup: () => invoke(legacy ? "legacy_cleanup_import" : "extension_cleanup_grants", { extensionId: id })
            })
          }
        })
      }
      renderSettings={view => <ExtensionMount id={view.id} />}
    />
  )
}
