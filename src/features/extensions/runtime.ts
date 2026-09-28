import * as sdk from "@alwith/module-extension"
import * as dom from "@alwith/module-extension/dom"
import { createCommonJsEvaluator, type ExtensionRuntime } from "@alwith/module-extension/host"
import { mountReact, useHostSnapshot } from "@alwith/module-extension/react"
import { createTauriExtensionRuntime } from "@alwith/module-extension/tauri"
import {
  createTauriDialogs,
  createTauriExternalLinks,
  createTauriHttp,
  createTauriNotifications
} from "@alwith/module-extension/tauri/capabilities"
import * as React from "react"
import * as jsxRuntime from "react/jsx-runtime"
import * as jsxDevRuntime from "react/jsx-dev-runtime"
import * as reactDom from "react-dom/client"
import { useEffect, useSyncExternalStore } from "react"
import { toast } from "sonner"

let runtime: ExtensionRuntime | undefined

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
    apiVersion: "0.1.3",
    capabilities: {
      [sdk.httpCapability.id]: createTauriHttp({
        allowUrl: url =>
          ["https://api.alwith.ai", "https://api-dev.alwith.ai"].includes(url.origin) &&
          url.pathname.startsWith("/service/")
      }),
      [sdk.notificationsCapability.id]: createTauriNotifications(),
      [sdk.externalLinksCapability.id]: createTauriExternalLinks({ allowUrl: () => true }),
      [sdk.dialogsCapability.id]: createTauriDialogs()
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
      "@alwith/module-extension": sdk,
      "@alwith/module-extension/dom": dom,
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
export function useExtensions() {
  const current = getRuntime()
  const state = useSyncExternalStore(current.subscribe, current.snapshot, current.snapshot)
  const host = useHostSnapshot(current.host)
  useEffect(() => {
    void current.start().catch(reportExtensionError)
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
    void runtime?.dispose().catch(reportExtensionError)
  })
