import { invoke } from "@tauri-apps/api/core"
import { ask } from "@tauri-apps/plugin-dialog"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ExtensionsManager } from "./extensions-manager"
import { ExtensionMount } from "./extension-view"
import { reportExtensionError, useExtensions } from "./runtime"
import { convertLegacyExtension, type PreparedLegacyImport } from "./legacy/import"
import { LEGACY_SOURCE } from "./legacy/profiles"

export function ExtensionsSection() {
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
    const selected = await invoke<
      { format: "current"; path: string; id: string } | { format: "legacy"; prepared: PreparedLegacyImport } | null
    >("extension_prepare_install", { expectedId: id ?? null })
    if (!selected) return
    if (selected.format === "legacy") {
      await importLegacy(selected.prepared)
      return
    }
    await runtime.request(
      id
        ? { type: "beginTransition", id, action: "update", path: selected.path, source: "local" }
        : { type: "installLocal", path: selected.path, source: "local", expectedId: selected.id }
    )
  }
  const importLegacy = async (prepared: PreparedLegacyImport): Promise<void> => {
    const existing = runtime.snapshot().native?.installations.find(item => item.id === prepared.manifest.id)
    if (existing && existing.source !== LEGACY_SOURCE) throw new Error(t("extensions.legacyConflict"))
    const converted = await convertLegacyExtension(prepared)
    const staged = await invoke<{ path: string; id: string; source: string }>("legacy_stage_import", {
      ticket: prepared.ticket,
      ...converted
    })
    await runtime.request(
      existing
        ? { type: "beginTransition", id: staged.id, action: "update", path: staged.path, source: staged.source }
        : { type: "installLocal", path: staged.path, source: staged.source, expectedId: staged.id }
    )
    if (!existing) await runtime.request({ type: "enable", id: staged.id })
  }
  return (
    <ExtensionsManager
      state={state}
      host={host}
      busy={busy}
      onInstall={id => run(() => install(id))}
      onRequest={request => run(() => runtime.request(request))}
      onUninstall={(id, name) =>
        run(async () => {
          if (
            await ask(t("extensions.uninstallConfirm", { name }), { title: t("settings.extensions"), kind: "warning" })
          )
            await runtime.request({ type: "beginTransition", id, action: "uninstall" })
        })
      }
      renderSettings={view => <ExtensionMount id={view.id} />}
    />
  )
}
