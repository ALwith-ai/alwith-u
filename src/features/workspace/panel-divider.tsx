import { type ReactNode, useEffect, useRef } from "react"

// Desktop's AtlasDivider, mirrored onto the preview's leading edge.
export function PanelDivider({
  label,
  width,
  direction,
  onStart,
  onDrag,
  onEnd
}: {
  label: string
  width: number
  direction: "ltr" | "rtl"
  onStart: () => void
  onDrag: (dx: number) => void
  onEnd: () => void
}): ReactNode {
  const startX = useRef<number | null>(null)
  const previousUserSelect = useRef("")
  const finishDrag = (): void => {
    if (startX.current === null) return
    startX.current = null
    document.body.style.userSelect = previousUserSelect.current
    onEnd()
  }
  useEffect(
    () => () => {
      if (startX.current !== null) document.body.style.userSelect = previousUserSelect.current
    },
    []
  )
  return (
    <hr
      data-no-drag
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={0}
      className="file-workspace-resize"
      onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus({ preventScroll: true })
        startX.current = event.clientX
        previousUserSelect.current = document.body.style.userSelect
        document.body.style.userSelect = "none"
        onStart()
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        if (startX.current === null) return
        event.preventDefault()
        onDrag((event.clientX - startX.current) * (direction === "rtl" ? 1 : -1))
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onKeyDown={event => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.preventDefault()
        onStart()
        onDrag((event.key === "ArrowLeft" ? 20 : -20) * (direction === "rtl" ? -1 : 1))
        onEnd()
      }}
    />
  )
}
