import { getPointerCenteredScrollPosition } from "@alwith/module-chat/pointer-centered-zoom"
import { Maximize2, Minus, Plus } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { DialogTitle } from "@/components/ui/dialog"

export function MermaidPreview({
  image,
  actions
}: {
  image: { src: string; width: number; height: number }
  actions: ReactNode
}) {
  const [viewport, setViewport] = useState<HTMLElement | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState<number | null>(1)
  const pending = useRef<{ left: number; top: number; centerX: number; centerY: number } | null>(null)
  const cancelGesture = useRef(() => {})
  const fit = size.width && size.height ? Math.min(size.width / image.width, size.height / image.height) : 1
  const scale = zoom ?? fit
  const minimum = Math.min(0.1, fit)
  const maximum = Math.max(8, fit)

  useLayoutEffect(() => {
    if (!viewport) return
    const measure = () => setSize({ width: viewport.clientWidth, height: viewport.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [viewport])

  const zoomTo = useCallback(
    (value: number, point?: { x: number; y: number }) => {
      if (!viewport || !imageRef.current) return
      const next = Math.min(maximum, Math.max(minimum, value))
      if (next === scale) return
      const bounds = viewport.getBoundingClientRect()
      const target = imageRef.current.getBoundingClientRect()
      const position = getPointerCenteredScrollPosition({
        container: viewport,
        target: imageRef.current,
        clientX: point?.x ?? bounds.left + viewport.clientWidth / 2,
        clientY: point?.y ?? bounds.top + viewport.clientHeight / 2,
        currentScale: scale,
        nextScale: next
      })
      pending.current = position && {
        ...position,
        centerX: target.left - bounds.left + viewport.scrollLeft + target.width / 2,
        centerY: target.top - bounds.top + viewport.scrollTop + target.height / 2
      }
      setZoom(next)
    },
    [maximum, minimum, scale, viewport]
  )

  useLayoutEffect(() => {
    const position = pending.current
    if (!position || !viewport || !imageRef.current) return
    pending.current = null
    const bounds = viewport.getBoundingClientRect()
    const target = imageRef.current.getBoundingClientRect()
    // The centered canvas grows when the image overflows; account for its new center.
    viewport.scrollLeft =
      position.left + target.left - bounds.left + viewport.scrollLeft + target.width / 2 - position.centerX
    viewport.scrollTop =
      position.top + target.top - bounds.top + viewport.scrollTop + target.height / 2 - position.centerY
  })

  const currentScale = useEffectEvent(() => scale)
  const applyGesture = useEffectEvent((value: number, point: { x: number; y: number }) => zoomTo(value, point))

  useEffect(() => {
    if (!viewport) return
    let frame = 0
    let wheelDelta = 0
    let gestureScale: number | null = null
    let gestureStart: number | null = null
    let point = { x: 0, y: 0 }
    const cancel = () => {
      cancelAnimationFrame(frame)
      frame = 0
      wheelDelta = 0
      gestureScale = null
      gestureStart = null
    }
    cancelGesture.current = cancel
    const flush = () => {
      frame = 0
      // Combine every delta in a frame instead of overwriting updates with a stale scale.
      applyGesture(gestureScale ?? currentScale() * Math.exp(-wheelDelta / 200), point)
      wheelDelta = 0
      gestureScale = null
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(flush)
    }
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      if (gestureStart !== null) return
      wheelDelta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1)
      point = { x: event.clientX, y: event.clientY }
      schedule()
    }
    const gesture = (event: Event) => {
      // WKWebView reports cumulative native pinch scale, unlike Chromium's wheel deltas.
      if (!("scale" in event) || typeof event.scale !== "number" || !Number.isFinite(event.scale) || event.scale <= 0)
        return
      event.preventDefault()
      event.stopPropagation()
      if (event.type === "gesturestart") {
        cancel()
        gestureStart = currentScale() / event.scale ** 2
      }
      if (gestureStart === null) return
      if (
        "clientX" in event &&
        typeof event.clientX === "number" &&
        "clientY" in event &&
        typeof event.clientY === "number"
      ) {
        point = { x: event.clientX, y: event.clientY }
      }
      // Amplify pinch distance symmetrically so reversing the gesture restores the scale.
      gestureScale = gestureStart * event.scale ** 2
      schedule()
      if (event.type === "gestureend") gestureStart = null
    }
    // React's delegated wheel listener is passive; pinch must not zoom the whole app.
    viewport.addEventListener("wheel", wheel, { passive: false })
    for (const name of ["gesturestart", "gesturechange", "gestureend"])
      viewport.addEventListener(name, gesture, { passive: false })
    return () => {
      cancel()
      cancelGesture.current = () => {}
      viewport.removeEventListener("wheel", wheel)
      for (const name of ["gesturestart", "gesturechange", "gestureend"]) viewport.removeEventListener(name, gesture)
    }
  }, [viewport])

  const reset = (nextZoom: number | null) => {
    cancelGesture.current()
    pending.current = null
    setZoom(nextZoom)
    if (viewport) {
      viewport.scrollLeft = 0
      viewport.scrollTop = 0
    }
  }

  return (
    <>
      <DialogTitle className="sr-only">Mermaid 图表</DialogTitle>
      <div className="flex shrink-0 items-center justify-end gap-1">{actions}</div>
      {/* Reserve both scrollbar tracks so WebKit keeps the fitted viewport stable while zooming. */}
      <section
        ref={setViewport}
        aria-label="图表预览"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable viewport supports keyboard panning and zoom.
        tabIndex={0}
        className="min-h-0 min-w-0 flex-1 overflow-scroll overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onKeyDown={(event) => {
          if (event.key === "+" || event.key === "=") {
            event.preventDefault()
            event.stopPropagation()
            zoomTo(scale * 1.25)
          } else if (event.key === "-") {
            event.preventDefault()
            event.stopPropagation()
            zoomTo(scale / 1.25)
          } else if (event.key === "0") {
            event.preventDefault()
            event.stopPropagation()
            reset(1)
          }
        }}
      >
        <div
          className="grid min-h-full min-w-full place-items-center"
          style={{ width: Math.ceil(image.width * scale), height: Math.ceil(image.height * scale) }}
        >
          <img
            ref={imageRef}
            src={image.src}
            alt="Mermaid 图表"
            draggable={false}
            onDoubleClick={() => reset(1)}
            className="block max-w-none select-none"
            style={{ width: image.width * scale, height: image.height * scale }}
          />
        </div>
      </section>
      <div className="flex shrink-0 items-center justify-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="缩小图片"
          title="缩小图片"
          disabled={scale <= minimum}
          onClick={() => zoomTo(scale / 1.25)}
        >
          <Minus />
        </Button>
        <Button
          variant="ghost"
          className="min-w-16 tabular-nums"
          aria-label="恢复原始尺寸"
          title="恢复原始尺寸"
          onClick={() => reset(1)}
        >
          {Math.round(scale * 100)}%
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="放大图片"
          title="放大图片"
          disabled={scale >= maximum}
          onClick={() => zoomTo(scale * 1.25)}
        >
          <Plus />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="适应窗口" title="适应窗口" onClick={() => reset(null)}>
          <Maximize2 />
        </Button>
      </div>
    </>
  )
}
