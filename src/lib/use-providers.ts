import { useEffect, useState } from "react"
import { listen } from "@tauri-apps/api/event"
import { toast } from "sonner"
import { loadProviders, PROVIDERS_CHANGED, type ProviderSnapshot } from "./providers"

export function useProviders() {
  const [snapshot, setSnapshot] = useState<ProviderSnapshot | null>(null)
  useEffect(() => {
    let active = true
    let received = false
    const stop = listen<ProviderSnapshot>(PROVIDERS_CHANGED, event => {
      received = true
      if (active) setSnapshot(event.payload)
    })
    void stop
      .then(() => loadProviders())
      .then(value => {
        if (active && !received) setSnapshot(value)
      })
      .catch((error: unknown) => {
        if (active) toast.error(String(error))
      })
    return () => {
      active = false
      void stop.then(fn => fn())
    }
  }, [])
  return snapshot
}
