import useEmblaCarousel from "embla-carousel-react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { PanelDivider } from "./panel-divider"
import { resolvePanelWidths } from "./panel-sizing"
import "./workspace.css"

// Desktop's two main Atlas regions, in chat/preview order. Both remain mounted.
export function WorkspacePanels({
  chat,
  preview,
  visible,
  maximized,
  onVisibleChange,
  onMaximizedChange
}: {
  chat: ReactNode
  preview: ReactNode
  visible: boolean
  maximized: boolean
  onVisibleChange: (visible: boolean) => void
  onMaximizedChange: (maximized: boolean) => void
}): ReactNode {
  const { t, i18n } = useTranslation()
  const root = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)
  const dragStart = useRef(0)
  const previousVisible = useRef(visible)
  const previousMaximized = useRef(maximized)
  const [draggingPreview, setDraggingPreview] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [previewWidth, setPreviewWidth] = useState(0)
  const [edges, setEdges] = useState({ previous: false, next: false })
  const [edgeZone, setEdgeZone] = useState<"start" | "end" | null>(null)
  const [emblaRef, embla] = useEmblaCarousel({
    axis: "x",
    direction: i18n.dir(),
    align: "start",
    containScroll: "keepSnaps",
    slidesToScroll: "auto",
    dragFree: false,
    watchResize: false,
    watchDrag: (_api, event) => !event.isTrusted
  })
  const widths = resolvePanelWidths(viewportWidth, visible, previewWidth)
  const chatWidth = maximized ? 0 : widths.chat
  const fileWidth = maximized ? viewportWidth : widths.preview

  useLayoutEffect(() => {
    const node = root.current
    if (!node) return
    const measure = (): void => setViewportWidth(node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || maximized) setPreviewWidth(0)
  }, [visible, maximized])

  useEffect(() => {
    if (!embla) return
    const update = (): void => setEdges({ previous: embla.canScrollPrev(), next: embla.canScrollNext() })
    embla.on("select", update).on("reInit", update)
    update()
    return () => {
      embla.off("select", update).off("reInit", update)
    }
  }, [embla])

  // biome-ignore lint/correctness/useExhaustiveDependencies: Embla must regroup after DOM widths change and after a divider drag finishes.
  useEffect(() => {
    if (!embla || dragging.current) return
    const selected = embla.internalEngine().slideRegistry[embla.selectedScrollSnap()]
    const region = !visible
      ? 0
      : !previousVisible.current || maximized || previousMaximized.current
        ? 1
        : (selected?.[0] ?? 0)
    previousVisible.current = visible
    previousMaximized.current = maximized
    embla.reInit()
    const snap = embla.internalEngine().slideRegistry.findIndex(group => group.includes(region))
    if (snap >= 0) embla.scrollTo(snap, true)
  }, [embla, chatWidth, fileWidth, visible, maximized, draggingPreview])

  // Desktop forwards middle-button panning to Embla; ordinary dragging belongs to content.
  useEffect(() => {
    if (!embla) return
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
  }, [embla])

  return (
    <div
      ref={root}
      className="file-workspace-layout"
      data-open={visible}
      data-view-mode={maximized}
      data-edge={edgeZone}
      onMouseMove={event => {
        const bounds = event.currentTarget.getBoundingClientRect()
        const x = i18n.dir() === "rtl" ? bounds.right - event.clientX : event.clientX - bounds.left
        setEdgeZone(x < 56 ? "start" : x > bounds.width - 56 ? "end" : null)
      }}
      onMouseLeave={() => setEdgeZone(null)}>
      <div ref={emblaRef} className="file-workspace-viewport">
        <div className="file-workspace-track">
          <div className="file-workspace-slide" style={{ width: chatWidth }} inert={maximized} aria-hidden={maximized}>
            <div className="file-workspace-slab">
              <div className="file-workspace-chat">{chat}</div>
            </div>
          </div>
          <div className="file-workspace-slide file-workspace-preview-slide" style={{ width: fileWidth }}>
            <div className="file-workspace-slab" inert={!visible} aria-hidden={!visible}>
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
                  dragStart.current = fileWidth
                  dragging.current = true
                  setDraggingPreview(true)
                }}
                onDrag={dx => {
                  const next = Math.max(0, Math.min(viewportWidth, dragStart.current + dx))
                  const hidePreview = dx < 0 && next <= 360
                  const hideChat = dx > 0 && viewportWidth - next <= 300
                  setPreviewWidth(hidePreview || hideChat ? 0 : Math.round(next))
                  onVisibleChange(!hidePreview)
                  onMaximizedChange(hideChat)
                }}
                onEnd={() => {
                  dragging.current = false
                  setDraggingPreview(false)
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
          onClick={() => embla?.scrollPrev()}>
          <ChevronLeft />
        </Button>
      )}
      {edges.next && (
        <Button
          className="workspace-page-arrow workspace-page-next"
          variant="outline"
          size="icon-sm"
          aria-label={t("workspace.nextPane")}
          onClick={() => embla?.scrollNext()}>
          <ChevronRight />
        </Button>
      )}
    </div>
  )
}
