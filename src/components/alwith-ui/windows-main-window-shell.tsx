import { isTauri } from "@tauri-apps/api/core"
import { platform } from "@tauri-apps/plugin-os"
import { createContext, type ReactElement, type ReactNode, useLayoutEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"
import { zoomStore } from "@/lib/zoom"

export const WindowsTitleBarContext = createContext<HTMLElement | null>(null)
export const WindowsWorkspaceControlsContext = createContext<HTMLElement | null>(null)

function WindowsTitleBar({
  mountControls,
  mountWorkspaceControls
}: {
  mountControls: (element: HTMLDivElement | null) => void
  mountWorkspaceControls: (element: HTMLDivElement | null) => void
}): ReactElement {
  const { t } = useTranslation()
  const zoom = useStore(zoomStore, state => state.level)

  useLayoutEffect(() => {
    const style = document.documentElement.style
    style.setProperty("--main-window-zoom", String(zoom))
    style.setProperty("--tauri-plugin-decoration-titlebar-height", `${32 / zoom}px`)
    return () => {
      style.removeProperty("--main-window-zoom")
      style.removeProperty("--tauri-plugin-decoration-titlebar-height")
    }
  }, [zoom])

  return (
    <header
      className="windows-main-titlebar flex shrink-0 items-center select-none"
      dir="ltr"
      style={{ height: 32 / zoom, paddingRight: "var(--tauri-plugin-decoration-right-clearance, 0px)" }}>
      <div className="flex h-full shrink-0 items-center px-3 text-xs" data-tauri-drag-region>
        <span className="pointer-events-none truncate">{t("app.name")}</span>
      </div>
      <div ref={mountControls} className="flex h-full shrink-0 items-center" />
      <div className="h-full min-w-0 flex-1" data-tauri-drag-region />
      <div ref={mountWorkspaceControls} className="windows-workspace-controls flex h-full shrink-0 items-center" />
    </header>
  )
}

export function WindowsMainWindowShell({ children }: { children: ReactNode }): ReactNode {
  const [controls, setControls] = useState<HTMLDivElement | null>(null)
  const [workspaceControls, setWorkspaceControls] = useState<HTMLDivElement | null>(null)
  if (!isTauri() || platform() !== "windows") return children
  return (
    <WindowsTitleBarContext.Provider value={controls}>
      <WindowsWorkspaceControlsContext.Provider value={workspaceControls}>
        <div className="flex h-full flex-col">
          <WindowsTitleBar mountControls={setControls} mountWorkspaceControls={setWorkspaceControls} />
          <div className="windows-main-content relative min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
      </WindowsWorkspaceControlsContext.Provider>
    </WindowsTitleBarContext.Provider>
  )
}
