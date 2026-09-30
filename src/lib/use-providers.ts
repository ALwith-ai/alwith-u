import { listen } from "@tauri-apps/api/event"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { loadProviders, PROVIDERS_CHANGED, type ProviderSnapshot } from "./providers"

export function useProviders() {
  const [snapshot, setSnapshot] = useState<ProviderSnapshot | null>(null)
  useEffect(() => {
    let active = true
    const stop = listen<ProviderSnapshot>(PROVIDERS_CHANGED, event => {
      if (active)
        setSnapshot(current => (current && current.revision > event.payload.revision ? current : event.payload))
    })
    void stop
      .then(() => loadProviders())
      .then(value => {
        if (active) setSnapshot(current => (current && current.revision >= value.revision ? current : value))
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
