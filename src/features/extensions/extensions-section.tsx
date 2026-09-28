import { invoke } from "@tauri-apps/api/core"
import { ask } from "@tauri-apps/plugin-dialog"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ExtensionsManager } from "./extensions-manager"
import { ExtensionMount } from "./extension-view"
import { reportExtensionError, useExtensions } from "./runtime"

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
    const path = await invoke<string | null>("plugin:extension|pick_local")
    if (!path) return
    await runtime.request(
      id
        ? { type: "beginTransition", id, action: "update", path, source: "local" }
        : { type: "installLocal", path, source: "local" }
    )
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
