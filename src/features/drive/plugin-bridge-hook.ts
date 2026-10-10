import { useEffect } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { toast } from "sonner"
import { drive, driveTransport } from "./controller"
import { getDrivePluginData, setDriveArchiveOwner, subscribeDrivePluginData, syncDrivePlugin } from "./plugin-bridge"

async function declineSessionSync(check: () => void): Promise<void> {
  const file = (operation: string, body?: number[]): Promise<unknown> =>
    invoke("legacy_file", {
      extensionId: "yup-kb",
      request: { operation, path: "sync-state.json", scope: null, ...(body ? { body } : {}) }
    })
  const stat = await file("stat")
  check()
  if (!stat || typeof stat !== "object" || !("exists" in stat)) throw new Error("Invalid plugin file status")
  if (!stat.exists) return
  const response = await file("read")
  check()
  if (!response || typeof response !== "object" || !("body" in response) || !Array.isArray(response.body))
    throw new Error("Invalid plugin sync state")
  const value: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(response.body)))
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Plugin sync state must be an object")
  const state = value as Record<string, unknown>
  if (state.consented === "declined") return
  check()
  await file("write", Array.from(new TextEncoder().encode(JSON.stringify({ ...state, consented: "declined" }))))
}

/** Main-window bridge: settings windows only notify this authoritative coordinator. */
export function useDrivePluginBridge(): void {
  useEffect(() => {
    if (!isTauri() || getCurrentWindow().label !== "main") return
    let closed = false
    let pending: Promise<void> | null = null
    let again = false
    let identity = ""
    const schedule = (): void => {
      if (closed) return
      if (!drive.getSnapshot().snapshot) return
      again = true
      if (pending) return
      pending = (async () => {
        while (again && !closed) {
          again = false
          try {
            await syncDrivePlugin(
              {
                request: request => driveTransport.request(request),
                binding: getDrivePluginData,
                generation: () => drive.getSnapshot().snapshot?.generation,
                setArchiveOwner: setDriveArchiveOwner,
                declineSessionSync
              },
              () => closed
            )
          } catch (error) {
            if (!closed) toast.error(`Knowledge plugin bridge failed: ${String(error)}`)
          }
        }
      })().finally(() => {
        pending = null
        if (again && !closed) schedule()
      })
    }
    const stopDrive = drive.subscribe(() => {
      const snapshot = drive.getSnapshot().snapshot
      const next = `${snapshot?.generation}:${snapshot?.configured}:${snapshot?.running}`
      if (next !== identity) {
        identity = next
        setDriveArchiveOwner(null)
        schedule()
      }
    })
    const stopBinding = subscribeDrivePluginData(schedule)
    let stopPolicy: (() => void) | undefined
    void listen("drive:policy-changed", () => {
      setDriveArchiveOwner(null)
      schedule()
    })
      .then(stop => {
        if (closed) stop()
        else {
          stopPolicy = stop
          schedule()
        }
      })
      .catch(error => {
        if (!closed) toast.error(String(error))
      })
    schedule()
    return () => {
      closed = true
      stopDrive()
      stopBinding()
      stopPolicy?.()
      setDriveArchiveOwner(null)
    }
  }, [])
}
