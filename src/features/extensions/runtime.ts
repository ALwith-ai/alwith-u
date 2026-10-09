import * as sdk from "@alwith/module-extension"
import * as dom from "@alwith/module-extension/dom"
import { createCommonJsEvaluator, type ExtensionRuntime } from "@alwith/module-extension/host"
import * as legacy from "@alwith/module-extension/legacy"
import * as plugin from "@alwith/module-extension/plugin"
import { mountReact, useHostSnapshot } from "@alwith/module-extension/react"
import { createTauriExtensionRuntime } from "@alwith/module-extension/tauri"
import {
  createTauriDialogs,
  createTauriExternalLinks,
  createTauriHttp,
  createTauriNotifications
} from "@alwith/module-extension/tauri/capabilities"
import { invoke } from "@tauri-apps/api/core"
import { emit, listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import * as React from "react"
import { useEffect, useSyncExternalStore } from "react"
import * as jsxDevRuntime from "react/jsx-dev-runtime"
import * as jsxRuntime from "react/jsx-runtime"
import * as reactDom from "react-dom/client"
import { toast } from "sonner"
import i18n from "@/lib/i18n"
import { version as hostVersion } from "../../../package.json"
import { type BundledExtension, ensureBundledExtensions } from "./bundled"
import { createHostCapabilities } from "./capabilities"
import { commonCapabilities } from "./capabilities/common"
import { createLegacyHost, createPluginHost } from "./legacy/host"
import { watchUninstallFailures, type UninstallFailures } from "./uninstall-failures"
import * as extensionUi from "./ui"

let startup: Promise<ExtensionRuntime> | undefined
let runtime: ExtensionRuntime | undefined
let uninstallFailures: (UninstallFailures & { dispose(): void }) | undefined

export function reportExtensionError(error: unknown): void {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : String(error)
  toast.error(message)
}

function getRuntime(): ExtensionRuntime {
  runtime ??= createTauriExtensionRuntime({
    apiVersion: sdk.extensionApiVersion,
    host: { id: "alwith-u", version: hostVersion },
    capabilities: {
      ...commonCapabilities,
      [plugin.pluginHostCapability.id]: createPluginHost(),
      [legacy.legacyHostCapability.id]: createLegacyHost(id =>
        runtime?.snapshot().native?.installations.find(item => item.id === id)
      ),
      ...createHostCapabilities(id => {
        if (!runtime) throw new Error("Extension runtime is not initialized")
        return runtime.snapshot().native?.installations.find(item => item.id === id)
      }, reportExtensionError),
      [sdk.httpCapability.id]: createTauriHttp({
        allowUrl: url =>
          ["https://api.alwith.ai", "https://api-dev.alwith.ai"].includes(url.origin) &&
          url.pathname.startsWith("/service/")
      }),
      [sdk.notificationsCapability.id]: createTauriNotifications({ language: () => i18n.language }),
      [sdk.externalLinksCapability.id]: createTauriExternalLinks({ allowUrl: () => true }),
      [sdk.dialogsCapability.id]: createTauriDialogs({ language: () => i18n.language })
    },
    contributions: {
      commands: "1.0.0",
      settings: "1.0.0",
      surfaces: "1.0.0",
      topBar: "1.0.0",
      navigation: "1.0.0",
      statusBar: "1.0.0",
      settingsPages: "1.0.0"
    },
    evaluate: createCommonJsEvaluator({
      "@alwith/u-extension-ui": extensionUi,
      "@alwith/module-extension": sdk,
      "@alwith/module-extension/dom": dom,
      "@alwith/module-extension/legacy": legacy,
      "@alwith/module-extension/plugin": plugin,
      "@alwith/module-extension/react": { mountReact },
      react: React,
      "react/jsx-runtime": jsxRuntime,
      "react/jsx-dev-runtime": jsxDevRuntime,
      "react-dom/client": reactDom
    })
  })
  return runtime
}

/** The runtime belongs to the WebView, not a React mount or the selected chat. */
export function startExtensionRuntime(): Promise<ExtensionRuntime> {
  const current = getRuntime()
  startup ??= (async () => {
    uninstallFailures = await watchUninstallFailures(current, {
      listen: listener =>
        listen<{ id: string; error: string }>("extension-uninstall:failed", event => listener(event.payload)),
      emit: failure => emit("extension-uninstall:failed", failure),
      report: reportExtensionError
    })
    await current.start()
    if (getCurrentWindow().label === "main")
      await ensureBundledExtensions(current, await invoke<BundledExtension[]>("extension_bundles"))
    return current
  })()
  return startup
}

export function getUninstallFailures(): UninstallFailures {
  if (!uninstallFailures) throw new Error("Extension failure bridge is not initialized")
  return uninstallFailures
}

export function useExtensions() {
  const current = getRuntime()
  const state = useSyncExternalStore(current.subscribe, current.snapshot, current.snapshot)
  const host = useHostSnapshot(current.host)
  useEffect(() => {
    void startExtensionRuntime().catch(reportExtensionError)
    const refresh = (): void => {
      void current.refresh().catch(reportExtensionError)
    }
    window.addEventListener("focus", refresh)
    return (): void => {
      window.removeEventListener("focus", refresh)
    }
  }, [current])
  return { runtime: current, state, host }
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    uninstallFailures?.dispose()
    void runtime?.dispose().catch(reportExtensionError)
  })
