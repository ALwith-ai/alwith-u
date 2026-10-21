import { PanelLeftDashedIcon, PanelLeftIcon } from "lucide-react"
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState
} from "react"
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
  const [preview, setPreview] = useState(false)
  // Remember the exit style after the logical state has already become hidden.
  const [presentation, setPresentation] = useState<"docked" | "floating">(initialPinned ? "docked" : "floating")
  const canvas = useMainCanvas(screen, pinned, onScreenChange)
  const navigate = canvas.context.navigate
  const mainActive = screen === "main"
  const showMainControls = mainActive && canvas.selected === 1
  const pinnedOnScreen = pinned && canvas.selected !== 2
  const docked = !mainActive || pinnedOnScreen
  const visible = docked || (mainActive && preview && !canvas.moving)
  const panelId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const pointerInside = useRef(false)
  const overlays = useRef(0)
  const insidePresses = useRef(new WeakSet<Event>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saving = useRef(Promise.resolve())

  const cancelClose = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const closePreview = useCallback(() => {
    cancelClose()
    if (!mainActive || pinnedOnScreen) return
    setPreview(false)
    if (panel.current?.contains(document.activeElement)) toggle.current?.focus({ preventScroll: true })
  }, [cancelClose, mainActive, pinnedOnScreen])

  const scheduleClose = useCallback(() => {
    cancelClose()
    if (!panel.current || !mainActive || pinnedOnScreen || pointerInside.current || overlays.current > 0) return
    timer.current = setTimeout(closePreview, 200)
  }, [cancelClose, closePreview, mainActive, pinnedOnScreen])

  const retainOverlay = useCallback(() => {
    overlays.current += 1
    cancelClose()
    return () => {
      overlays.current -= 1
      scheduleClose()
    }
  }, [cancelClose, scheduleClose])

  const changePinned = useCallback(
    (next: boolean) => {
      cancelClose()
      if (!mainActive) return
      setPresentation("docked")
      if (next && canvas.selected === 2) navigate("chat")
      setPinned(next)
      setPreview(false)
      // Serialize writes so rapid toggles cannot restore an older choice on restart.
      saving.current = saving.current
        .then(() => savePreference("sidebarPinned", next))
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : String(error))
        })
    },
    [cancelClose, mainActive, canvas.selected, navigate]
  )

  useEffect(() => cancelClose, [cancelClose])

  useEffect(() => {
    if (!docked && !canvas.moving) return
    cancelClose()
    pointerInside.current = false
    setPreview(false)
  }, [docked, canvas.moving, cancelClose])

  useEffect(() => {
    if (!visible && panel.current?.contains(document.activeElement)) toggle.current?.focus({ preventScroll: true })
  }, [visible, showMainControls])

  useEffect(() => {
    if (!mainActive || pinnedOnScreen || !preview) return
    const onPointerDown = (event: PointerEvent) => {
      // React capture also sees events in this sidebar's portals, unlike DOM.contains().
      if (!insidePresses.current.has(event)) closePreview()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && overlays.current === 0) {
        event.preventDefault()
        closePreview()
      }
    }
    window.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("blur", closePreview)
    return () => {
      window.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("blur", closePreview)
    }
  }, [mainActive, pinnedOnScreen, preview, closePreview])

  const enterSidebar = (event: ReactPointerEvent) => {
    if (!mainActive || event.pointerType === "touch") return
    pointerInside.current = true
    cancelClose()
    if (!pinnedOnScreen) {
      setPresentation("floating")
      setPreview(true)
    }
  }
  const leaveSidebar = (event: ReactPointerEvent) => {
    if (!mainActive || event.pointerType === "touch") return
    pointerInside.current = false
    scheduleClose()
  }
  const ToggleIcon = pinned ? PanelLeftIcon : PanelLeftDashedIcon

  const sidebarToggle = (
    <div
      className={titlebar ? "windows-sidebar-toggle" : "main-sidebar-toggle"}
      style={titlebar ? { width: 32 / zoom, height: 32 / zoom } : undefined}
      onPointerEnter={enterSidebar}
      onPointerLeave={leaveSidebar}
      onPointerDownCapture={(event) => insidePresses.current.add(event.nativeEvent)}
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
                <div
                  className="main-sidebar-shell"
                  onPointerEnter={enterSidebar}
                  onPointerLeave={leaveSidebar}
                  onPointerDownCapture={(event) => insidePresses.current.add(event.nativeEvent)}
                  onFocusCapture={cancelClose}
                  onBlurCapture={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose()
                  }}
                >
                  <div className="main-sidebar-viewport">
                    <div
                      ref={(node) => {
                        panel.current = node
                        canvas.navigationRef(node)
                      }}
                      id={panelId}
                      className="main-sidebar-panel"
                      inert={!visible && !canvas.moving}
                      aria-hidden={!visible && !canvas.moving}
                    >
                      {sidebar}
                    </div>
                  </div>
                  {mainActive && !pinnedOnScreen && <div className="main-sidebar-edge" aria-hidden="true" />}
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
            </div>
          </div>
        </div>
      </CanvasContext.Provider>
      <footer className="main-window-statusbar">
        <CanvasDots count={canvas.geometry.stops.length} selected={canvas.selected} onSelect={canvas.select} />
        {statusBar}
      </footer>
      {children}
    </SidebarProvider>
  )
}
