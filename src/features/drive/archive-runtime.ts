import { useEffect } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { toast } from "sonner"
import { client } from "@/lib/client"
import { drive } from "./controller"
import { createDriveArchive } from "./archive"
export const DRIVE_ARCHIVE_SYNC = "drive:archive-sync"
export function useDriveArchive(): void {
  useEffect(() => {
    if (!isTauri()) return
    const archive = createDriveArchive({
      request: request => drive.request(request),
      source: {
        list: check => client.listHistorySessions(check),
        export: (id, check, signal) => client.exportHistory(id, check, signal)
      },
      onError: error => toast.error(String(error))
    })
    const ready = (): boolean => {
      const { connected, snapshot } = drive.getSnapshot()
      return connected && snapshot?.configured === true && snapshot.running && client.state.connection === "ready"
    }
    const sync = (): void => {
      if (!ready()) return
      void archive.sync().catch((error: unknown) => toast.error(String(error)))
    }
    const timer = setInterval(sync, 5 * 60 * 1000)
    const stop = listen(DRIVE_ARCHIVE_SYNC, sync)
    let configured = false
    const reconcile = (): void => {
      const available = ready()
      if (available && !configured) sync()
      configured = available
    }
    const unsubscribe = drive.subscribe(reconcile)
    const stopClient = client.store.subscribe(reconcile)
    reconcile()
    return () => {
      clearInterval(timer)
      unsubscribe()
      stopClient()
      archive.dispose()
      void stop.then(fn => fn()).catch((error: unknown) => toast.error(String(error)))
    }
  }, [])
}
