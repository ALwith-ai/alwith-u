import { PanelLeftDashedIcon, PanelLeftIcon } from "lucide-react"
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useStore } from "zustand"
import { SidebarOverlayContext } from "@/components/alwith-ui/sidebar-overlay-context"
import { Button } from "@/components/ui/button"
import { SidebarProvider } from "@/components/ui/sidebar"
import { isMac } from "@/lib/platform"
import { savePreference } from "@/lib/preferences"
import { zoomStore } from "@/lib/zoom"

export function MainSidebarLayout({
  initialPinned,
  sidebar,
  children
}: {
  initialPinned: boolean
  sidebar: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const zoom = useStore(zoomStore, state => state.level)
  const [pinned, setPinned] = useState(initialPinned)
  const [preview, setPreview] = useState(false)
  // Remember the exit style after the logical state has already become hidden.
  const [presentation, setPresentation] = useState<"docked" | "floating">(initialPinned ? "docked" : "floating")
  const visible = pinned || preview
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
    if (pinned) return
    setPreview(false)
    if (panel.current?.contains(document.activeElement)) toggle.current?.focus({ preventScroll: true })
  }, [cancelClose, pinned])

  const scheduleClose = useCallback(() => {
    cancelClose()
    if (!panel.current || pinned || pointerInside.current || overlays.current > 0) return
    timer.current = setTimeout(closePreview, 200)
  }, [cancelClose, closePreview, pinned])

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
    [cancelClose]
  )

  useEffect(() => cancelClose, [cancelClose])

  useEffect(() => {
    if (pinned || !preview) return
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
  }, [pinned, preview, closePreview])

  return (
    <SidebarProvider
      open={pinned}
      onOpenChange={changePinned}
      className="relative h-full"
      data-sidebar-mode={pinned ? "pinned" : preview ? "floating" : "hidden"}
      data-sidebar-presentation={presentation}
      style={
        {
          "--main-sidebar-width": pinned ? "var(--sidebar-width)" : "0px",
          "--sidebar-toggle-left": `${(isMac() ? 80 : 8) / zoom}px`,
          "--sidebar-control-scale": 1 / zoom
        } as CSSProperties
      }>
      <SidebarOverlayContext.Provider value={retainOverlay}>
        <div
          className="main-sidebar-shell"
          onPointerEnter={event => {
            if (event.pointerType === "touch") return
            pointerInside.current = true
            cancelClose()
            if (!pinned) setPresentation("floating")
            setPreview(true)
          }}
          onPointerLeave={event => {
            if (event.pointerType === "touch") return
            pointerInside.current = false
            scheduleClose()
          }}
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
          {!pinned && <div className="main-sidebar-edge" aria-hidden="true" />}
          <div className="main-sidebar-toggle">
            <Button
              ref={toggle}
              variant="ghost"
              size="icon-xs"
              role="switch"
              aria-label={t("sidebar.pin")}
              aria-checked={pinned}
              aria-expanded={visible}
              aria-controls={panelId}
              title={t(pinned ? "sidebar.unpin" : "sidebar.pin")}
              className="text-sidebar-foreground"
              onClick={() => changePinned(!pinned)}>
              {pinned ? <PanelLeftIcon className="size-4" /> : <PanelLeftDashedIcon className="size-4" />}
            </Button>
          </div>
        </div>
      </SidebarOverlayContext.Provider>
      {children}
    </SidebarProvider>
  )
}
