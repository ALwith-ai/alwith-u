import { Minus, Plus } from "lucide-react"
import { type ComponentType, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { buildArgsParam } from "storybook/internal/router"

import { Button } from "../../src/components/ui/button"
import { ProductPreview, type ProductPreviewProps } from "./product-preview"
import { playback, type WorkflowConfig, workflowTarget } from "./workflow-driver"

const pageWidth = 1200
const pageHeight = 760
const cardWidth = 1100
const cardHeight = Math.ceil(((cardWidth - 2) * pageHeight) / pageWidth) + 2
const columnGap = 164
const padding = 32
const arrowHeadWidth = 18
const arrowBodyHeight = (label: string) => (label.length > 16 ? 52 : 36)

function checkpointUrl(
  config: WorkflowConfig,
  index: number,
  args: ProductPreviewProps,
  globals: Record<string, unknown>
) {
  const base = import.meta.env.STORYBOOK_TEST ? "http://127.0.0.1:6007/" : window.location.href
  const url = new URL("iframe.html", base)
  url.searchParams.set("args", buildArgsParam({}, args))
  url.searchParams.set("globals", buildArgsParam({}, globals))
  url.searchParams.set("id", `${config.id}--sequence`)
  url.searchParams.set("viewMode", "story")
  url.searchParams.set("workflowStep", String(index))
  return url.href
}

function pageTitle(config: WorkflowConfig, index: number) {
  if (index === 0) return config.labels[index]!.replace(/^初始页面 · /, "")
  if (index === config.labels.length - 1) return config.labels[index]!.replace(/^完成 · /, "")
  return config.labels[index]!.replace(/^(点击|双击|输入|清空|选择) · /, "")
}

function WorkflowStep({
  config,
  index,
  args,
  globals,
  active,
  onSettled
}: {
  config: WorkflowConfig
  index: number
  args: ProductPreviewProps
  globals: Record<string, unknown>
  active: boolean
  onSettled: (index: number) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [result, setResult] = useState<{ ready: boolean; error: string | null }>({ ready: false, error: null })
  const width = cardWidth
  const height = cardHeight
  const previewHeight = height - 2
  const scale = Math.min((width - 2) / pageWidth, previewHeight / pageHeight)
  useEffect(() => {
    function receive(event: MessageEvent) {
      const current = frame.current
      if (!current || event.source !== current.contentWindow || event.origin !== new URL(current.src).origin) return
      // Nested previews must not send navigation or global updates into the outer Storybook manager.
      if (
        event.data?.key === "storybook-channel" ||
        (typeof event.data === "string" && /"key"\s*:\s*"storybook-channel"/.test(event.data))
      ) {
        event.stopImmediatePropagation()
        return
      }
      if (event.data?.type !== "workflow-checkpoint" || event.data.id !== config.id || event.data.target !== index)
        return
      setResult({ ready: event.data.finished, error: event.data.error })
      if (event.data.finished || event.data.error) onSettled(index)
    }
    window.addEventListener("message", receive, true)
    return () => window.removeEventListener("message", receive, true)
  }, [config.id, index, onSettled])
  return (
    <section
      className="group relative"
      style={{ width, height }}
      aria-label={`步骤 ${index + 1}：${pageTitle(config, index)}`}
      data-workflow-step={index}
      data-ready={result.ready}
      data-error={result.error ?? undefined}
    >
      <div
        className="relative overflow-hidden rounded-lg border bg-background shadow-sm"
        style={{ height: previewHeight + 2 }}
        data-workflow-page-image=""
      >
        {active && (
          <iframe
            ref={frame}
            title={`步骤 ${index + 1} · ${pageTitle(config, index)}`}
            src={checkpointUrl(config, index, args, globals)}
            tabIndex={-1}
            className="pointer-events-none absolute top-0 left-0 border-0"
            style={{
              width: pageWidth,
              height: pageHeight,
              zoom: scale
            }}
          />
        )}
        {!result.ready && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-background/90 px-4 text-center text-sm text-muted-foreground"
            role={result.error ? "alert" : "status"}
          >
            {result.error ? `页面加载失败：${result.error}` : "正在准备页面…"}
          </div>
        )}
      </div>
    </section>
  )
}

function WorkflowDiagram({
  config,
  args,
  globals
}: {
  config: WorkflowConfig
  args: ProductPreviewProps
  globals: Record<string, unknown>
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const pan = useRef<{ pointerId: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(
    null
  )
  const [dragging, setDragging] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [size, setSize] = useState({ width: 1200, height: 760 })
  const [activeSteps, setActiveSteps] = useState(1)
  // Sibling frames share keyboard focus. Replay them in order and retain completed checkpoints.
  const settled = useCallback((index: number) => setActiveSteps((count) => Math.max(count, index + 2)), [])
  const width = padding * 2 + config.labels.length * cardWidth + (config.labels.length - 1) * columnGap
  const height = padding * 2 + cardHeight
  const scale = zoom
  const position = (index: number) => ({ x: padding + index * (cardWidth + columnGap), y: padding })
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry!.contentRect.width, height: entry!.contentRect.height })
    )
    observer.observe(viewport.current!)
    return () => observer.disconnect()
  }, [])
  const adjustZoom = (factor: number) => setZoom(Math.min(3, Math.max(0.1, scale * factor)))
  const contentWidth = Math.max(size.width, width * scale)
  const contentHeight = Math.max(size.height, height * scale)
  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-sidebar text-foreground [--workflow-arrow-foreground:var(--color-white)] [--workflow-arrow:oklch(0.52_0.08_255)]"
      data-workflow-diagram=""
      data-view="overview"
    >
      <div
        className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-4 py-3"
        role="toolbar"
        aria-label="流程图控制"
      >
        <div className="mr-auto">
          <span className="text-sm font-semibold">完整流程图</span>
          <span className="ml-3 text-xs text-muted-foreground">共 {config.labels.length} 步 · 按住画布左右拖动</span>
        </div>
        <Button size="sm" variant="ghost" aria-label="缩小流程图" onClick={() => adjustZoom(1 / 1.25)}>
          <Minus />
        </Button>
        <span className="w-12 text-center text-xs tabular-nums" data-workflow-zoom="">
          {Math.round(scale * 100)}%
        </span>
        <Button size="sm" variant="ghost" aria-label="放大流程图" onClick={() => adjustZoom(1.25)}>
          <Plus />
        </Button>
      </div>
      <div
        ref={viewport}
        className="min-h-0 flex-1 overflow-auto"
        style={{
          overflowAnchor: "none",
          touchAction: "none",
          userSelect: "none",
          cursor: dragging ? "grabbing" : "grab"
        }}
        data-workflow-viewport=""
        data-dragging={dragging}
        onPointerDownCapture={(event) => {
          if (event.button !== 0 || !event.isPrimary) return
          pan.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: event.currentTarget.scrollLeft,
            top: event.currentTarget.scrollTop,
            moved: false
          }
        }}
        onPointerMoveCapture={(event) => {
          const start = pan.current
          if (!start || start.pointerId !== event.pointerId) return
          const dx = event.clientX - start.x,
            dy = event.clientY - start.y
          if (!start.moved && Math.hypot(dx, dy) < 5) return
          if (!start.moved) {
            start.moved = true
            event.currentTarget.setPointerCapture(event.pointerId)
            setDragging(true)
          }
          event.preventDefault()
          event.currentTarget.scrollLeft = start.left - dx
          event.currentTarget.scrollTop = start.top - dy
        }}
        onPointerUpCapture={(event) => {
          const start = pan.current
          if (!start || start.pointerId !== event.pointerId) return
          pan.current = null
          setDragging(false)
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => {
          pan.current = null
          setDragging(false)
        }}
        onLostPointerCapture={() => {
          pan.current = null
          setDragging(false)
        }}
      >
        <div className="relative overflow-hidden" style={{ width: contentWidth, height: contentHeight }}>
          <div
            style={{
              width,
              height,
              zoom: scale,
              position: "absolute",
              left: Math.max(0, (size.width - width * scale) / (2 * scale)),
              top: 0
            }}
          >
            <svg
              width={width}
              height={height}
              className="pointer-events-none absolute inset-0 text-[var(--workflow-arrow)]"
              aria-hidden="true"
              data-workflow-connections=""
            >
              {config.labels.slice(1).map((label, index) => {
                const from = position(index),
                  to = position(index + 1)
                const y = from.y + cardHeight / 2
                const start = from.x + cardWidth + 8
                const end = to.x - 10
                const shoulder = end - arrowHeadWidth
                const bodyHeight = arrowBodyHeight(label)
                const headHeight = bodyHeight + 12
                const route = `M ${start} ${y - bodyHeight / 2}
                  H ${shoulder} V ${y - headHeight / 2}
                  L ${end} ${y} L ${shoulder} ${y + headHeight / 2}
                  V ${y + bodyHeight / 2} H ${start} Z`
                return <path key={index} d={route} data-from={index} data-to={index + 1} fill="currentColor" />
              })}
            </svg>
            {config.labels.slice(1).map((label, index) => {
              const from = position(index),
                to = position(index + 1)
              const x = from.x + cardWidth + 8
              const y = from.y + cardHeight / 2
              return (
                <div
                  key={`action-${index}`}
                  data-workflow-action={index + 1}
                  className="pointer-events-none absolute flex -translate-y-1/2 items-center justify-center px-2 py-0.5 text-center text-xs leading-4 font-medium break-all text-[var(--workflow-arrow-foreground)]"
                  style={{ left: x, top: y, width: to.x - 10 - arrowHeadWidth - x, height: arrowBodyHeight(label) }}
                >
                  {label}
                </div>
              )
            })}
            {config.labels.map((_, index) => {
              const { x, y } = position(index)
              return (
                <div
                  key={index}
                  style={{
                    position: "absolute",
                    left: x,
                    top: y
                  }}
                >
                  <WorkflowStep
                    config={config}
                    index={index}
                    args={args}
                    globals={globals}
                    active={index < activeSteps}
                    onSettled={settled}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
function WorkflowCheckpoint({
  args,
  config,
  target,
  Preview
}: {
  args: ProductPreviewProps
  config: WorkflowConfig
  target: number
  Preview: ComponentType<ProductPreviewProps>
}) {
  const state = useSyncExternalStore(playback.subscribe, playback.snapshot)
  useEffect(() => {
    window.parent.postMessage(
      { type: "workflow-checkpoint", id: config.id, target, finished: state.finished, error: state.error },
      new URL(document.referrer || window.location.href).origin
    )
  }, [config.id, target, state])
  return (
    <div
      id="workflow-page"
      className="h-dvh overflow-hidden bg-sidebar text-foreground"
      data-workflow-checkpoint={target}
      data-ready={state.finished}
    >
      <style>{`[data-workflow-paused] #workflow-page *, [data-workflow-paused] #workflow-page *::before, [data-workflow-paused] #workflow-page *::after { animation-play-state: paused !important; } #workflow-page > div { height: 100%; }`}</style>
      {state.error && <div role="alert">流程页面加载失败：{state.error}</div>}
      <Preview {...args} />
    </div>
  )
}

export function WorkflowPreview({
  args,
  config,
  globals,
  Preview = ProductPreview
}: {
  args: ProductPreviewProps
  config: WorkflowConfig
  globals: Record<string, unknown>
  Preview?: ComponentType<ProductPreviewProps>
}) {
  const target = workflowTarget(config)
  return target === null ? (
    <WorkflowDiagram key={JSON.stringify([args, globals])} config={config} args={args} globals={globals} />
  ) : (
    <WorkflowCheckpoint args={args} config={config} target={target} Preview={Preview} />
  )
}
