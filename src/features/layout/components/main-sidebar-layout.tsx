import { PanelLeftDashedIcon, PanelLeftIcon, PanelRightDashedIcon, PanelRightIcon } from "lucide-react"
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useStore } from "zustand"
import { SidebarOverlayContext } from "@/components/alwith-ui/sidebar-overlay-context"
import { Button } from "@/components/ui/button"
import { SidebarProvider } from "@/components/ui/sidebar"
import { isMac } from "@/lib/platform"
import { savePreference } from "@/lib/preferences"
import { zoomStore } from "@/lib/zoom"

export type MainScreen = "main" | "leading"

export function MainSidebarLayout({
  initialPinned,
  screen,
  sidebar,
  leading,
  main,
  children
}: {
  initialPinned: boolean
  screen: MainScreen
  sidebar: ReactNode
  leading: ReactNode
  main: ReactNode
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const zoom = useStore(zoomStore, state => state.level)
  const [pinned, setPinned] = useState(initialPinned)
  const [leadingSidebarOpen, setLeadingSidebarOpen] = useState(true)
  const [preview, setPreview] = useState(false)
  // Remember the exit style after the logical state has already become hidden.
  const [presentation, setPresentation] = useState<"docked" | "floating">(initialPinned ? "docked" : "floating")
  const mainActive = screen === "main"
  const docked = mainActive ? pinned : leadingSidebarOpen
  const visible = docked || (mainActive && preview)
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
    if (!mainActive || pinned) return
    setPreview(false)
    if (panel.current?.contains(document.activeElement)) toggle.current?.focus({ preventScroll: true })
  }, [cancelClose, mainActive, pinned])

  const scheduleClose = useCallback(() => {
    cancelClose()
    if (!panel.current || !mainActive || pinned || pointerInside.current || overlays.current > 0) return
    timer.current = setTimeout(closePreview, 200)
  }, [cancelClose, closePreview, mainActive, pinned])

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
      if (!mainActive) {
        setLeadingSidebarOpen(next)
        return
      }
      setPresentation("docked")
      setPinned(next)
      setPreview(false)
      // Serialize writes so rapid toggles cannot restore an older choice on restart.
      saving.current = saving.current
        .then(() => savePreference("sidebarPinned", next))
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : String(error))
        })
    },
    [cancelClose, mainActive]
  )

  useEffect(() => cancelClose, [cancelClose])

  useEffect(() => {
    if (mainActive) return
    cancelClose()
    pointerInside.current = false
    setPreview(false)
  }, [mainActive, cancelClose])

  useEffect(() => {
    if (!visible && panel.current?.contains(document.activeElement)) toggle.current?.focus({ preventScroll: true })
  }, [visible])

  useEffect(() => {
    if (!mainActive || pinned || !preview) return
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
  }, [mainActive, pinned, preview, closePreview])

  const enterSidebar = (event: ReactPointerEvent) => {
    if (!mainActive || event.pointerType === "touch") return
    pointerInside.current = true
    cancelClose()
    if (!pinned) setPresentation("floating")
    setPreview(true)
  }
  const leaveSidebar = (event: ReactPointerEvent) => {
    if (!mainActive || event.pointerType === "touch") return
    pointerInside.current = false
    scheduleClose()
  }
  const ToggleIcon = mainActive
    ? pinned
      ? PanelLeftIcon
      : PanelLeftDashedIcon
    : leadingSidebarOpen
      ? PanelRightIcon
      : PanelRightDashedIcon

  return (
    <SidebarProvider
      open={docked}
      onOpenChange={changePinned}
      className="relative h-full overflow-clip"
      data-main-screen={screen}
      data-sidebar-mode={docked ? "pinned" : visible ? "floating" : "hidden"}
      data-sidebar-presentation={mainActive ? presentation : "docked"}
      style={
        {
          "--main-sidebar-width": pinned ? "var(--sidebar-width)" : "0px",
          "--leading-sidebar-width": leadingSidebarOpen ? "var(--sidebar-width)" : "0px",
          "--active-sidebar-width": docked ? "var(--sidebar-width)" : "0px",
          "--sidebar-toggle-left": `${(isMac() ? 80 : 8) / zoom}px`,
          "--sidebar-control-scale": 1 / zoom
        } as CSSProperties
      }>
      <div className="main-screen-track">
        <div className="main-screen-leading" data-screen-panel="leading" inert={mainActive} aria-hidden={mainActive}>
          {leading}
        </div>
        <SidebarOverlayContext.Provider value={retainOverlay}>
          <div
            className="main-sidebar-shell"
            onPointerEnter={enterSidebar}
            onPointerLeave={leaveSidebar}
            onPointerDownCapture={event => insidePresses.current.add(event.nativeEvent)}
            onFocusCapture={cancelClose}
            onBlurCapture={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose()
            }}>
            <div className="main-sidebar-viewport">
              <div ref={panel} id={panelId} className="main-sidebar-panel" inert={!visible} aria-hidden={!visible}>
                {sidebar}
              </div>
            </div>
            {mainActive && !pinned && <div className="main-sidebar-edge" aria-hidden="true" />}
          </div>
        </SidebarOverlayContext.Provider>
        <div className="main-screen-content" data-screen-panel="main" inert={!mainActive} aria-hidden={!mainActive}>
          {main}
        </div>
      </div>
      <div
        className="main-sidebar-toggle"
        onPointerEnter={enterSidebar}
        onPointerLeave={leaveSidebar}
        onPointerDownCapture={event => insidePresses.current.add(event.nativeEvent)}>
        <Button
          ref={toggle}
          variant="ghost"
          size="icon-xs"
          role="switch"
          aria-label={t(mainActive ? "sidebar.pin" : "sidebar.toggleRight")}
          aria-checked={docked}
          aria-expanded={visible}
          aria-controls={panelId}
          title={t(
            mainActive
              ? pinned
                ? "sidebar.unpin"
                : "sidebar.pin"
              : leadingSidebarOpen
                ? "sidebar.hideRight"
                : "sidebar.showRight"
          )}
          className="text-sidebar-foreground"
          onClick={() => changePinned(!docked)}>
          <ToggleIcon className="size-4" />
        </Button>
      </div>
      {children}
    </SidebarProvider>
  )
}
