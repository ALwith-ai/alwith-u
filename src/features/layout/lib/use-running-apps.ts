import { isTauri } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { useEffect, useRef, useState } from "react"

import { type AppInfo, commands } from "@/bindings"
import { reportPetError } from "@/features/vibemon/display-error"

/** Share installed-app discovery and activation with the native module. */
export function useRunningApps(active: boolean): AppInfo[] {
  const [apps, setApps] = useState<AppInfo[]>([])
  const installed = useRef<Promise<AppInfo[]> | undefined>(undefined)
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let checking = false
    const discover = async () => {
      const browser = await commands.defaultBrowser()
      const [browsers, communication] = await Promise.all([
        browser ? commands.readAppsInfo({ names: [browser], withIcons: true }) : Promise.resolve([]),
        commands.readAppsInfo({ names: ["飞书", "Lark", "Feishu"], withIcons: true })
      ])
      return [...new Map([...browsers, ...communication].map((app) => [app.bundle_id, app])).values()]
    }
    const check = async () => {
      if (checking || disposed) return
      checking = true
      try {
        installed.current ??= discover().catch((error: unknown) => {
          installed.current = undefined
          throw error
        })
        const candidates = await installed.current
        const running = await Promise.all(candidates.map((app) => commands.isAppRunning({ bundleId: app.bundle_id })))
        if (!disposed) setApps(candidates.filter((_, index) => running[index]))
      } catch (error) {
        if (!disposed) reportPetError(error)
      } finally {
        checking = false
      }
    }
    void check()
    const timer = setInterval(() => {
      if (active) void check()
    }, 4000)
    const unlisten = getCurrentWebviewWindow().onFocusChanged(() => void check())
    return () => {
      disposed = true
      clearInterval(timer)
      void unlisten.then((stop) => stop()).catch(reportPetError)
    }
  }, [active])
  return apps
}
