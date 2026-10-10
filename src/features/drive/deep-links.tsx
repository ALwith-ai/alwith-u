import { useEffect, useRef } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link"
import { driveFileWebUrl, parseDriveFileDeepLinkPath } from "@alwith/module-drive/content"
import type { RemoteId } from "@alwith/module-drive"
import { toast } from "sonner"
import { openExternal } from "@/lib/open"
import { drive } from "./controller"
import { safeDriveWebUrl } from "./files"

/** Mount only in the main workspace. The callback authorizes and opens the indexed project. */
export function useDriveDeepLinks(openTarget: (path: string) => Promise<void>): void {
  const target = useRef(openTarget)
  target.current = openTarget
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let busy = false
    let stopUrls: (() => void) | undefined
    const queued = new Map<string, RemoteId>()
    const delivered = new Map<string, number>()
    const inFlight = new Set<string>()
    const drain = async (): Promise<void> => {
      if (busy || disposed) return
      busy = true
      try {
        while (!disposed && queued.size) {
          const snapshot = drive.getSnapshot().snapshot
          if (!snapshot?.configured || !snapshot.running) return
          const generation = snapshot.generation
          const entry = queued.entries().next().value
          if (!entry) return
          const [key, fileId] = entry
          queued.delete(key)
          inFlight.add(key)
          try {
            let local: string | null = null
            let lookupError: unknown
            try {
              const response = await drive.request({ type: "localPath", fileId })
              if (response.type !== "path") throw new Error("Invalid Drive local path response")
              local = response.data
            } catch (error) {
              lookupError = error
            }
            if (disposed) return
            const current = drive.getSnapshot().snapshot
            if (current?.generation !== generation || !current.running) {
              throw new Error("Drive profile changed while opening the link")
            }
            if (local !== null) await target.current(local)
            else {
              if (!current.webBaseUrl)
                throw new Error("Drive link is unavailable locally and has no web destination", { cause: lookupError })
              const url = safeDriveWebUrl(driveFileWebUrl(current.webBaseUrl, fileId))
              toast.info("This file is not available locally; opening it on the web")
              await openExternal(url)
            }
          } catch (error) {
            if (!disposed) toast.error(String(error))
          } finally {
            inFlight.delete(key)
            delivered.set(key, Date.now())
          }
        }
      } finally {
        busy = false
      }
    }
    const receive = (urls: string[]): void => {
      if (disposed) return
      const now = Date.now()
      for (const [key, at] of delivered) if (now - at > 1000) delivered.delete(key)
      for (const raw of urls) {
        try {
          const url = new URL(raw)
          if (url.protocol !== "alwith-u:" || url.hostname !== "yup-drive") continue
          const fileId = parseDriveFileDeepLinkPath(url.pathname)
          if (fileId === null || url.username || url.password || url.port || url.search || url.hash) {
            throw new Error("Invalid ALwith U Drive link")
          }
          const key = String(fileId)
          if (!delivered.has(key) && !inFlight.has(key)) queued.set(key, fileId)
        } catch (error) {
          toast.error(String(error))
        }
      }
      void drain()
    }
    const stopDrive = drive.subscribe(() => {
      void drain()
    })
    // Subscribe first so a link arriving while getCurrent resolves is not lost.
    void onOpenUrl(receive)
      .then(stop => {
        if (disposed) {
          stop()
          return
        }
        stopUrls = stop
        return getCurrent().then(urls => {
          if (urls) receive(urls)
        })
      })
      .catch(error => {
        if (!disposed) toast.error(String(error))
      })
    return () => {
      disposed = true
      queued.clear()
      stopDrive()
      stopUrls?.()
    }
  }, [])
}
