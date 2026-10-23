import "@nyssance/atlas/styles.css"
import { desktopDefaults } from "@nyssance/atlas/layout"
import { PanelLeftDashedIcon, PanelLeftIcon } from "lucide-react"
import { type CSSProperties, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useStore } from "zustand"

import { SidebarOverlayContext } from "@/components/alwith-ui/sidebar-overlay-context"
import {
  WindowsTitleBarContext,
  WindowsWorkspaceControlsContext
} from "@/components/alwith-ui/windows-main-window-shell"
import { Button } from "@/components/ui/button"
import { SidebarProvider } from "@/components/ui/sidebar"
import { isMac } from "@/lib/platform"
import { savePreference } from "@/lib/preferences"
import { useWindowFullscreen } from "@/lib/use-window-fullscreen"
import { zoomStore } from "@/lib/zoom"

import { CanvasContext } from "../lib/canvas-context"
import { useMainCanvas } from "../lib/use-main-canvas"
import { CanvasDots } from "./canvas-dots"

export type MainScreen = "main" | "leading"

export function MainSidebarLayout({
  initialPinned,
  screen,
  onScreenChange,
  sidebar,
  leading,
  main,
  trailing,
  toolbar,
  statusBar,
  children
}: {
  initialPinned: boolean
  screen: MainScreen
  onScreenChange?: (screen: MainScreen) => void
  sidebar: ReactNode
  leading: ReactNode
  main: ReactNode
  trailing?: ReactNode
  toolbar?: ReactNode
  statusBar?: ReactNode
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const zoom = useStore(zoomStore, (state) => state.level)
  const titlebar = useContext(WindowsTitleBarContext)
  const workspaceControls = useContext(WindowsWorkspaceControlsContext)
  const fullscreen = useWindowFullscreen()
  const [pinned, setPinned] = useState(initialPinned)
  const [presentation, setPresentation] = useState<"docked" | "floating">(initialPinned ? "docked" : "floating")
  const canvas = useMainCanvas(screen, pinned, onScreenChange, trailing !== undefined)
  const navigate = canvas.context.navigate
  const mainActive = screen === "main"
  const showMainControls = mainActive && canvas.selected === 1
  const pinnedOnScreen = pinned && canvas.selected === 1
  const docked = !mainActive || pinnedOnScreen
  const visible = docked || canvas.navigationPeeking
  const panelId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const overlays = useRef(0)
  const saving = useRef(Promise.resolve())

  // Portaled menus retain the same Atlas-owned navigation surface.
  const retainOverlay = useCallback(() => {
    overlays.current += 1
    panel.current?.parentElement?.setAttribute("data-popup-open", "")
    return () => {
      overlays.current -= 1
      if (overlays.current === 0) panel.current?.parentElement?.removeAttribute("data-popup-open")
    }
  }, [])

  const changePinned = useCallback(
    (next: boolean) => {
      if (!mainActive) return
      if (next && canvas.selected > 1) navigate("chat")
      setPresentation("docked")
      setPinned(next)
      // Serialize writes so rapid toggles cannot restore an older choice on restart.
      saving.current = saving.current
        .then(() => savePreference("sidebarPinned", next))
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : String(error))
        })
    },
    [mainActive, canvas.selected, navigate]
  )

  useEffect(() => {
    if (canvas.navigationPeeking) setPresentation("floating")
  }, [canvas.navigationPeeking])

  useEffect(() => {
    if (!visible && panel.current?.contains(document.activeElement)) toggle.current?.focus({ preventScroll: true })
  }, [visible, showMainControls])

  const ToggleIcon = pinned ? PanelLeftIcon : PanelLeftDashedIcon

  const sidebarToggle = (
    <div
      className={titlebar ? "windows-sidebar-toggle" : "main-sidebar-toggle"}
      style={titlebar ? { width: 32 / zoom, height: 32 / zoom } : undefined}
    >
      <Button
        ref={toggle}
        variant="ghost"
        size="icon-xs"
        role="switch"
        aria-label={t("sidebar.pin")}
        aria-checked={docked}
        aria-expanded={visible}
        aria-controls={panelId}
        data-atlas-navigation-trigger
        title={t(pinned ? "sidebar.unpin" : "sidebar.pin")}
        className="text-sidebar-foreground"
        onClick={() => changePinned(!docked)}
      >
        <ToggleIcon className="size-4 rtl:-scale-x-100" />
      </Button>
    </div>
  )

  return (
    <SidebarProvider
      open={docked}
      onOpenChange={changePinned}
      className="relative h-full min-h-0 flex-col overflow-clip"
      data-main-screen={screen}
      data-canvas-moving={canvas.moving}
      data-canvas-pinned={pinned}
      data-sidebar-mode={docked ? "pinned" : visible ? "floating" : "hidden"}
      data-sidebar-presentation={docked || canvas.moving ? "docked" : presentation}
      style={
        {
          "--sidebar-width": `${desktopDefaults.navigationWidth}px`,
          "--leading-sidebar-width": "var(--sidebar-width)",
          "--canvas-sidebar-offset": `${Math.max(0, (canvas.geometry.stops[canvas.selected] ?? 0) - canvas.geometry.leading)}px`,
          "--active-sidebar-width": docked ? "var(--sidebar-width)" : "0px",
          // Native window controls keep their size when page content zooms.
          "--sidebar-toggle-left": isMac() && !fullscreen ? "calc(80px * var(--window-zoom-correction))" : "8px"
        } as CSSProperties
      }
    >
      <header className="main-window-titlebar" data-tauri-drag-region>
        {showMainControls && !titlebar && sidebarToggle}
        {showMainControls && !workspaceControls && toolbar}
      </header>
      {showMainControls && workspaceControls && toolbar && createPortal(toolbar, workspaceControls)}
      {showMainControls && titlebar && createPortal(sidebarToggle, titlebar)}
      <CanvasContext.Provider value={canvas.context}>
        <div className="main-window-body" dir={canvas.direction}>
          <div ref={canvas.ref} className="main-canvas-viewport">
            <div
              className="main-screen-track"
              data-atlas-track
              style={
                {
                  "--canvas-leading-width": `${canvas.geometry.leading}px`,
                  // CSS resolves the single-screen width before ResizeObserver delivers new geometry.
                  "--canvas-content-width": canvas.context.split
                    ? `${canvas.geometry.content}px`
                    : `calc(100% + var(--canvas-leading-width) - ${pinned ? "var(--sidebar-width)" : "0px"})`
                } as CSSProperties
              }
            >
              {canvas.geometry.stops.map((offset, index) => (
                <div
                  key={index}
                  className="canvas-snap"
                  data-atlas-region={canvas.geometry.regions[index]}
                  data-atlas-leading={index === 0 ? "" : undefined}
                  aria-hidden="true"
                  style={{ insetInlineStart: offset, width: canvas.width }}
                />
              ))}
              <div
                className="main-screen-leading"
                data-screen-panel="leading"
                inert={mainActive}
                aria-hidden={mainActive}
              >
                {leading}
              </div>
              <SidebarOverlayContext.Provider value={retainOverlay}>
                <div className="main-sidebar-shell" data-atlas-navigation ref={canvas.navigationRef}>
                  <div className="main-sidebar-viewport" data-atlas-navigation-surface id={panelId}>
                    <div
                      ref={panel}
                      className="main-sidebar-panel"
                      inert={!visible && !canvas.moving}
                      aria-hidden={!visible && !canvas.moving}
                    >
                      {sidebar}
                    </div>
                  </div>
                </div>
              </SidebarOverlayContext.Provider>
              <div
                className="main-screen-content"
                data-screen-panel="main"
                inert={!mainActive}
                aria-hidden={!mainActive}
              >
                {main}
              </div>
              {trailing !== undefined && (
                <aside
                  className="main-screen-trailing"
                  data-screen-panel="trailing"
                  inert={canvas.geometry.regions[canvas.selected] !== "trailing" && !canvas.moving}
                >
                  {trailing}
                </aside>
              )}
            </div>
          </div>
        </div>
      </CanvasContext.Provider>
      <footer className="main-window-statusbar">
        <CanvasDots
          count={canvas.geometry.stops.length - 1}
          selected={canvas.selected - 1}
          onSelect={(index) => canvas.select(index + 1)}
        />
        {statusBar}
      </footer>
      {children}
    </SidebarProvider>
  )
}
