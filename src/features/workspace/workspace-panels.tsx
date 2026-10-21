import useEmblaCarousel from "embla-carousel-react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  type ReactNode,
  type Ref,
  useImperativeHandle,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react"
import { flushSync } from "react-dom"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { CanvasContext } from "@/features/layout/lib/canvas-context"

import { PanelControlsContext, type PanelControls } from "./panel-controls-context"
import { PanelDivider } from "./panel-divider"
import { resolvePanelWidths } from "./panel-sizing"
import "./workspace.css"

// Desktop's two main Atlas regions, in chat/preview order. Both remain mounted.
export function WorkspacePanels({
  chat,
  preview,
  visible,
  maximized,
  onMaximizedChange,
  controlsRef
}: {
  controlsRef?: Ref<PanelControls>
  chat: ReactNode
  preview: ReactNode
  visible: boolean
  maximized: boolean
  onVisibleChange: (visible: boolean) => void
  onMaximizedChange: (maximized: boolean) => void
}): ReactNode {
  const { t, i18n } = useTranslation()
  const canvas = useContext(CanvasContext)
  const unified = canvas !== null
  const root = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)
  const dragStart = useRef(0)
  const previousVisible = useRef(visible)
  const previousMaximized = useRef(maximized)
  const [draggingPreview, setDraggingPreview] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [previewWidth, setPreviewWidth] = useState(0)
  const [manuallySeparated, setManuallySeparated] = useState(false)
  const [edges, setEdges] = useState({ previous: false, next: false })
  const [edgeZone, setEdgeZone] = useState<"start" | "end" | null>(null)
  const [emblaRef, embla] = useEmblaCarousel({
    active: !unified,
    axis: "x",
    direction: i18n.dir(),
    align: "start",
    containScroll: "keepSnaps",
    slidesToScroll: "auto",
    dragFree: false,
    watchResize: false,
    watchDrag: (_api, event) => !event.isTrusted
  })
  const budget = canvas?.budget ?? viewportWidth
  const fullViewportWidth = canvas?.viewportWidth ?? viewportWidth
  const widths = resolvePanelWidths(budget, visible, previewWidth, fullViewportWidth, manuallySeparated)
  const chatWidth = maximized ? 0 : widths.chat
  const fileWidth = maximized ? budget : widths.preview
  const expanded = maximized || (visible && budget > 0 && widths.chat + widths.preview > budget)
  const toggleExpanded = (): void => {
    if (expanded) {
      setPreviewWidth(0)
      setManuallySeparated(false)
      onMaximizedChange(false)
      canvas?.navigate("chat")
    } else {
      onMaximizedChange(true)
    }
  }
  useImperativeHandle(controlsRef, () => ({ expanded, toggleExpanded }))
  const reportWorkspace = canvas?.setWorkspace
  const navigate = canvas?.navigate
  useLayoutEffect(() => {
    reportWorkspace?.({ chat: chatWidth, preview: fileWidth, visible, maximized })
  }, [reportWorkspace, chatWidth, fileWidth, visible, maximized])
  useEffect(() => {
    if (!navigate) return
    if (visible && (!previousVisible.current || (maximized && !previousMaximized.current))) navigate("preview")
    previousVisible.current = visible
    previousMaximized.current = maximized
  }, [navigate, visible, maximized])

  useLayoutEffect(() => {
    const node = root.current
    if (!node || unified) return
    const measure = (): void => setViewportWidth(node.clientWidth)
    measure()
    const observer = new ResizeObserver(() => flushSync(measure))
    observer.observe(node)
    return () => observer.disconnect()
  }, [unified])

  useEffect(() => {
    if (!visible || maximized) {
      setPreviewWidth(0)
      setManuallySeparated(false)
    }
  }, [visible, maximized])

  useEffect(() => {
    if (!embla || unified) return
    const update = (): void => setEdges({ previous: embla.canScrollPrev(), next: embla.canScrollNext() })
    embla.on("select", update).on("reInit", update)
    update()
    return () => {
      embla.off("select", update).off("reInit", update)
    }
  }, [embla, unified])

  useLayoutEffect(() => {
    if (!embla || unified || dragging.current) return
    const selected = embla.internalEngine().slideRegistry[embla.selectedScrollSnap()]
    const region = !visible
      ? 0
      : !previousVisible.current || maximized || previousMaximized.current
        ? 1
        : (selected?.[0] ?? 0)
    previousVisible.current = visible
    previousMaximized.current = maximized
    embla.reInit()
    const snap = embla.internalEngine().slideRegistry.findIndex((group) => group.includes(region))
    if (snap >= 0) embla.scrollTo(snap, true)
  }, [embla, unified, chatWidth, fileWidth, visible, maximized, draggingPreview])

  // Desktop forwards middle-button panning to Embla; ordinary dragging belongs to content.
  useEffect(() => {
    if (!embla || unified) return
    const node = embla.rootNode()
    let panning = false
    const forward = (type: string, event: PointerEvent): void => {
      node.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
          button: 0
        })
      )
    }
    const down = (event: PointerEvent): void => {
      if (event.button !== 1 || (event.target instanceof HTMLElement && event.target.closest("[data-no-drag]"))) return
      event.preventDefault()
      panning = true
      node.style.cursor = "grabbing"
      forward("mousedown", event)
    }
    const move = (event: PointerEvent): void => {
      if (panning) forward("mousemove", event)
    }
    const up = (event: PointerEvent): void => {
      if (!panning) return
      panning = false
      node.style.cursor = ""
      forward("mouseup", event)
    }
    node.addEventListener("pointerdown", down)
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
    return () => {
      node.style.cursor = ""
      node.removeEventListener("pointerdown", down)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
  }, [embla, unified])

  return (
    <PanelControlsContext.Provider value={{ expanded, toggleExpanded }}>
      <div
        ref={root}
        className="file-workspace-layout"
        data-unified-canvas={canvas !== null}
        data-split={!maximized && visible && widths.chat + widths.preview > budget}
        data-open={visible}
        data-view-mode={maximized}
        data-edge={edgeZone}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          const x = i18n.dir() === "rtl" ? bounds.right - event.clientX : event.clientX - bounds.left
          setEdgeZone(x < 56 ? "start" : x > bounds.width - 56 ? "end" : null)
        }}
        onMouseLeave={() => setEdgeZone(null)}
      >
        <div ref={emblaRef} className="file-workspace-viewport">
          <div className="file-workspace-track">
            <div
              className="file-workspace-slide"
              style={{ width: !visible && !maximized && !canvas ? "100%" : chatWidth }}
              inert={maximized || (canvas?.split && canvas.selected === 2)}
              aria-hidden={maximized}
            >
              <div className="file-workspace-slab">
                <div className="file-workspace-chat">{chat}</div>
              </div>
            </div>
            <div className="file-workspace-slide file-workspace-preview-slide" style={{ width: fileWidth }}>
              <div
                className="file-workspace-slab"
                inert={!visible || (canvas?.split && canvas.selected !== 2)}
                aria-hidden={!visible}
              >
                <aside id="file-workspace-panel" className="file-workspace-panel" aria-label={t("workspace.files")}>
                  {preview}
                </aside>
              </div>
              {(draggingPreview || (visible && !maximized)) && (
                <PanelDivider
                  label={t("workspace.resize")}
                  width={fileWidth}
                  direction={i18n.dir()}
                  onStart={() => {
                    if (maximized) onMaximizedChange(false)
                    // Keep the requested width when splitting substitutes a full-screen display width.
                    dragStart.current = previewWidth || fileWidth
                    dragging.current = true
                    setDraggingPreview(true)
                    canvas?.setDividerDragging(true)
                  }}
                  onDrag={(dx) => {
                    // Zero means automatic sizing; retain a positive request across the split threshold.
                    const requested = Math.max(1, Math.round(dragStart.current + dx))
                    // Growing preview collapses chat at its minimum; shrinking preview still moves it to the next screen.
                    const hideChat = dx > 0 && budget - requested <= 320
                    onMaximizedChange(hideChat)
                    const next = resolvePanelWidths(budget, true, requested, fullViewportWidth)
                    setPreviewWidth(requested)
                    // A manual split survives navigation and window resizing until another divider adjustment.
                    setManuallySeparated(next.chat + next.preview > budget)
                  }}
                  onEnd={() => {
                    // A manual resize on main overrides preview intent retained from an earlier merged layout.
                    if (canvas?.selected === 1 && !maximized) canvas.navigate("chat")
                    dragging.current = false
                    setDraggingPreview(false)
                    canvas?.setDividerDragging(false)
                  }}
                />
              )}
            </div>
          </div>
        </div>
        {edges.previous && (
          <Button
            className="workspace-page-arrow workspace-page-previous"
            variant="outline"
            size="icon-sm"
            aria-label={t("workspace.previousPane")}
            onClick={() => embla?.scrollPrev()}
          >
            <ChevronLeft />
          </Button>
        )}
        {edges.next && (
          <Button
            className="workspace-page-arrow workspace-page-next"
            variant="outline"
            size="icon-sm"
            aria-label={t("workspace.nextPane")}
            onClick={() => embla?.scrollNext()}
          >
            <ChevronRight />
          </Button>
        )}
      </div>
    </PanelControlsContext.Provider>
  )
}
