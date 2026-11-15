import { invoke, isTauri } from "@tauri-apps/api/core"
import { useEffect, useState } from "react"

export interface RuntimeCapabilities {
  backend: "wry" | "cef"
  embeddedBrowser: boolean
  canSwitchBackend?: boolean
}
export const runtimeCapabilities = () => invoke<RuntimeCapabilities>("runtime_capabilities")

export function useRuntimeCapabilities() {
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null)
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    void runtimeCapabilities()
      .then((value) => {
        if (!disposed) setCapabilities(value)
      })
      .catch(console.error)
    return () => {
      disposed = true
    }
  }, [])
  return capabilities
}
