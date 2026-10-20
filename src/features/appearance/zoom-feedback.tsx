import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { MinusIcon, PlusIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useStore } from "zustand"

import { events } from "@/bindings"
import { Button } from "@/components/ui/button"
import { resetZoom, ZOOM_LEVELS, zoomIn, zoomOut, zoomStore } from "@/lib/zoom"

function report(error: unknown): void {
  toast.error(error instanceof Error ? error.message : String(error))
}

/** Mounted once in each window that exposes zoom controls. */
export function ZoomFeedback({ showFeedback = true }: { showFeedback?: boolean }) {
  const { t } = useTranslation()
  const { level, interaction } = useStore(zoomStore)
  const [dismissed, setDismissed] = useState(interaction)
  const [hovered, setHovered] = useState(false)
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const keyboard = useRef(false)
  const visible = showFeedback && interaction !== dismissed

  useEffect(() => {
    const window = getCurrentWebviewWindow()
    const listeners = Promise.all([
      window.listen<null>(events["menu:zoom-in"].name, () => void zoomIn().catch(report)),
      window.listen<null>(events["menu:zoom-out"].name, () => void zoomOut().catch(report)),
      window.listen<null>(events["menu:actual-size"].name, () => void resetZoom().catch(report))
    ])
    const keydown = (event: KeyboardEvent) => {
      keyboard.current = true
      if (
        !/Win/.test(navigator.platform) ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.isComposing ||
        event.defaultPrevented
      )
        return
      const action =
        event.key === "=" || event.key === "+"
          ? zoomIn
          : event.key === "-"
            ? zoomOut
            : event.key === "0"
              ? resetZoom
              : null
      if (action === null) return
      event.preventDefault()
      void action().catch(report)
    }
    const pointerdown = () => {
      keyboard.current = false
      setKeyboardFocus(false)
    }
    document.addEventListener("keydown", keydown)
    document.addEventListener("pointerdown", pointerdown, true)
    return () => {
      void listeners
        .then((stops) => {
          for (const stop of stops) stop()
        })
        .catch(report)
      document.removeEventListener("keydown", keydown)
      document.removeEventListener("pointerdown", pointerdown, true)
    }
  }, [])

  useEffect(() => {
    if (!visible || hovered || keyboardFocus) return
    const timer = setTimeout(() => setDismissed(interaction), 2000)
    return () => clearTimeout(timer)
  }, [visible, interaction, hovered, keyboardFocus])

  if (!visible) return null
  return createPortal(
    <fieldset
      aria-label={t("zoom.label")}
      className="zoom-feedback fixed z-50 flex h-12 items-center gap-1 rounded-2xl border bg-popover px-3 text-popover-foreground shadow-lg [-webkit-app-region:no-drag]"
      style={{ top: 40, right: 12 }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setKeyboardFocus(keyboard.current)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false)
      }}
    >
      <span className="min-w-12 text-center text-sm font-semibold tabular-nums" role="status" aria-live="polite">
        {Math.round(level * 100)}%
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-lg"
        disabled={level === ZOOM_LEVELS[0]}
        aria-label={t("shortcuts.items.zoomOut")}
        title={t("shortcuts.items.zoomOut")}
        onClick={() => void zoomOut().catch(report)}
      >
        <MinusIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-lg"
        disabled={level === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
        aria-label={t("shortcuts.items.zoomIn")}
        title={t("shortcuts.items.zoomIn")}
        onClick={() => void zoomIn().catch(report)}
      >
        <PlusIcon />
      </Button>
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
      <Button
        variant="ghost"
        size="sm"
        className="rounded-lg"
        disabled={level === 1}
        onClick={() => void resetZoom().catch(report)}
      >
        {t("zoom.reset")}
      </Button>
    </fieldset>,
    document.body
  )
}
