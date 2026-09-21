/**
 * 无装饰窗自绘 resize 边缘。macOS 上 tao 0.35.3 的 drag_resize_window(即前端
 * startResizeDragging)直接返回 NotSupported(tao-0.35.3/src/platform_impl/macos/window.rs:963),
 * 系统只在 borderless+Resizable 窗贴边极窄的原生判定带里能缩放——所以 macOS 由本组件
 * pointer capture 跟手,逐帧调 resize_window_edge 原子换框(min/max 钳制在 Rust 侧);
 * 其余平台 startResizeDragging 可用,原样交给系统。
 * 命中区:四边 8px(再宽会盖住贴边内容的点击,如聊天区右缘滚动条)、四角 16px;
 * 只缩放整个窗口,不承担 pane 分栏调整。
 * chat 窗 完整/迷你形态共用。
 */
import { getCurrentWindow } from "@tauri-apps/api/window"
import { platform } from "@tauri-apps/plugin-os"
import { type PointerEvent as ReactPointerEvent, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"

// @tauri-apps/api 未导出 ResizeDirection 类型,从方法签名反推
type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>["startResizeDragging"]>[0]

// 每个 WebView 一条队列；完整/迷你形态卸载重挂也必须等上一轮已发送的尺寸请求完成。
let pendingResize = Promise.resolve()

function dragResizeMacos(direction: ResizeDirection, event: ReactPointerEvent<HTMLDivElement>): () => void {
  const win = getCurrentWindow()
  const target = event.currentTarget
  const { pointerId, screenX: startX, screenY: startY } = event
  const listeners = new AbortController()
  let ended = false
  let cancelled = false
  const movement: { latest: { x: number; y: number } | null } = { latest: null }
  let lastX = startX
  let lastY = startY
  let wake: (() => void) | null = null
  const finish = (cancel: boolean) => {
    if (cancel) {
      cancelled = true
      movement.latest = null
    }
    if (!ended) {
      ended = true
      listeners.abort()
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
    }
    wake?.()
  }
  const update = (pointer: PointerEvent) => {
    if (pointer.screenX === lastX && pointer.screenY === lastY) return
    lastX = pointer.screenX
    lastY = pointer.screenY
    movement.latest = { x: lastX, y: lastY }
    wake?.()
  }
  const onMove = (pointer: PointerEvent) => {
    if (pointer.pointerId !== pointerId) return
    if ((pointer.buttons & 1) === 0) {
      finish(true)
      return
    }
    update(pointer)
  }
  const onUp = (pointer: PointerEvent) => {
    if (pointer.pointerId !== pointerId) return
    update(pointer)
    finish(false)
  }
  const onCancel = (pointer: PointerEvent) => {
    if (pointer.pointerId === pointerId) finish(true)
  }
  // 必须在任何 await 之前监听结束事件，否则快速松手会留下持续修改窗框的监听。
  const options = { signal: listeners.signal }
  window.addEventListener("pointermove", onMove, options)
  window.addEventListener("pointerup", onUp, options)
  window.addEventListener("pointercancel", onCancel, options)
  window.addEventListener("blur", () => finish(true), options)
  target.addEventListener("lostpointercapture", onCancel, options)
  target.setPointerCapture(pointerId)

  const previous = pendingResize
  let release!: () => void
  pendingResize = new Promise<void>(resolve => {
    release = resolve
  })
  void (async () => {
    try {
      await previous
      if (ended) return
      const [position, size, scaleFactor] = await Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor()])
      if (ended) return
      const west = direction.includes("West")
      const north = direction.includes("North")
      const east = direction.includes("East")
      const south = direction.includes("South")
      // 命令在飞时仅保留最新坐标；正常松手提交尾帧，取消或被新拖拽替代时丢弃未发送目标。
      while (!cancelled) {
        if (movement.latest === null) {
          if (ended) return
          await new Promise<void>(resolve => {
            wake = resolve
          })
          wake = null
          continue
        }
        const point = movement.latest
        movement.latest = null
        // 屏幕绝对坐标不受窗框每帧变化影响；尺寸请求串行完成后才采样下一轮起始窗框。
        const dx = Math.round((point.x - startX) * scaleFactor)
        const dy = Math.round((point.y - startY) * scaleFactor)
        await invoke("resize_chat_window", {
          direction,
          x: position.x + (west ? dx : 0),
          y: position.y + (north ? dy : 0),
          width: size.width + (east ? dx : west ? -dx : 0),
          height: size.height + (south ? dy : north ? -dy : 0)
        })
      }
    } finally {
      finish(true)
      release()
    }
  })()
  return () => finish(true)
}

export function WindowResizeEdges({ vertical = true }: { vertical?: boolean }) {
  const cancelResize = useRef<(() => void) | null>(null)
  useEffect(() => () => cancelResize.current?.(), [])
  const start = (direction: ResizeDirection) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    if (platform() === "macos") {
      cancelResize.current?.()
      cancelResize.current = dragResizeMacos(direction, e)
    } else {
      void getCurrentWindow().startResizeDragging(direction)
    }
  }
  return (
    <>
      <div className="absolute inset-y-0 left-0 z-50 w-2 cursor-ew-resize" onPointerDown={start("West")} />
      <div className="absolute inset-y-0 right-0 z-50 w-2 cursor-ew-resize" onPointerDown={start("East")} />
      {vertical && (
        <>
          <div className="absolute inset-x-0 top-0 z-50 h-2 cursor-ns-resize" onPointerDown={start("North")} />
          <div className="absolute inset-x-0 bottom-0 z-50 h-2 cursor-ns-resize" onPointerDown={start("South")} />
          <div className="absolute top-0 left-0 z-50 size-4 cursor-nwse-resize" onPointerDown={start("NorthWest")} />
          <div className="absolute top-0 right-0 z-50 size-4 cursor-nesw-resize" onPointerDown={start("NorthEast")} />
          <div
            className="absolute right-0 bottom-0 z-50 size-4 cursor-nwse-resize"
            onPointerDown={start("SouthEast")}
          />
          <div className="absolute bottom-0 left-0 z-50 size-4 cursor-nesw-resize" onPointerDown={start("SouthWest")} />
        </>
      )}
    </>
  )
}
