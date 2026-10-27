import { useHostSnapshot } from "@alwith/module-extension/react"
import { useEffect, useSyncExternalStore } from "react"

import { getRuntime, reportExtensionError, startExtensionRuntime } from "./runtime"
import { refreshExtensions } from "./startup-import-control"

export function useExtensions() {
  const current = getRuntime()
  const state = useSyncExternalStore(current.subscribe, current.snapshot, current.snapshot)
  const host = useHostSnapshot(current.host)
  useEffect(() => {
    void startExtensionRuntime().catch(reportExtensionError)
    const refresh = (): void => {
      void refreshExtensions().catch(reportExtensionError)
    }
    window.addEventListener("focus", refresh)
    return (): void => {
      window.removeEventListener("focus", refresh)
    }
  }, [current])
  return { runtime: current, state, host }
}
