import { isTauri } from "@tauri-apps/api/core"
import { platform } from "@tauri-apps/plugin-os"
import { createContext, type ReactElement, type ReactNode, useLayoutEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"

import { zoomStore } from "@/lib/zoom"

import appIcon from "../../../src-tauri/icons/64x64.png"

export const WindowsTitleBarContext = createContext<HTMLElement | null>(null)
export const WindowsWorkspaceControlsContext = createContext<HTMLElement | null>(null)
export const WindowsExtensionControlsContext = createContext<HTMLElement | null>(null)

function WindowsTitleBar({
  mountControls,
  mountWorkspaceControls,
  mountExtensionControls
}: {
  mountControls: (element: HTMLDivElement | null) => void
  mountWorkspaceControls: (element: HTMLDivElement | null) => void
  mountExtensionControls: (element: HTMLDivElement | null) => void
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
      <div
        className="flex h-full shrink-0 items-center"
        style={{ paddingInline: 12 / zoom }}
        title={t("app.name")}
        data-tauri-drag-region>
        <img
          src={appIcon}
          alt={t("app.name")}
          draggable={false}
          className="pointer-events-none object-contain"
          style={{ width: 24 / zoom, height: 24 / zoom }}
        />
      </div>
      <div ref={mountControls} className="flex h-full shrink-0 items-center" />
      <div className="relative h-full min-w-0 flex-1" data-tauri-drag-region>
        <div
          ref={mountExtensionControls}
          className="windows-extension-controls pointer-events-none absolute inset-0 flex items-center px-2"
        />
      </div>
      <div ref={mountWorkspaceControls} className="windows-workspace-controls flex h-full shrink-0 items-center" />
    </header>
  )
}

export function WindowsMainWindowShell({ children }: { children: ReactNode }): ReactNode {
  const [controls, setControls] = useState<HTMLDivElement | null>(null)
  const [workspaceControls, setWorkspaceControls] = useState<HTMLDivElement | null>(null)
  const [extensionControls, setExtensionControls] = useState<HTMLDivElement | null>(null)
  if (!isTauri() || platform() !== "windows") return children
  return (
    <WindowsTitleBarContext.Provider value={controls}>
      <WindowsWorkspaceControlsContext.Provider value={workspaceControls}>
        <WindowsExtensionControlsContext.Provider value={extensionControls}>
          <div className="flex h-full flex-col">
            <WindowsTitleBar
              mountControls={setControls}
              mountWorkspaceControls={setWorkspaceControls}
              mountExtensionControls={setExtensionControls}
            />
            <div className="windows-main-content relative min-h-0 flex-1 overflow-hidden">{children}</div>
          </div>
        </WindowsExtensionControlsContext.Provider>
      </WindowsWorkspaceControlsContext.Provider>
    </WindowsTitleBarContext.Provider>
  )
}
