import { useRef } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"

export function CanvasDots({
  count,
  selected,
  onSelect
}: {
  count: number
  selected: number
  onSelect: (index: number) => void
}) {
  const { t, i18n } = useTranslation()
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  if (count <= 1) return null
  return (
    <nav className="canvas-dots flex shrink-0 items-center justify-center" aria-label={t("canvas.navigation")}>
      {Array.from({ length: count }, (_, index) => (
        <Button
          key={index}
          ref={(node) => {
            buttons.current[index] = node
          }}
          variant="ghost"
          size="icon-xs"
          className="rounded-full"
          aria-label={t("canvas.page", { number: index + 1 })}
          aria-current={selected === index ? "page" : undefined}
          onClick={() => onSelect(index)}
          onKeyDown={(event) => {
            const forward = i18n.dir() === "rtl" ? "ArrowLeft" : "ArrowRight"
            const backward = i18n.dir() === "rtl" ? "ArrowRight" : "ArrowLeft"
            const target =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? count - 1
                  : event.key === forward
                    ? Math.min(count - 1, index + 1)
                    : event.key === backward
                      ? Math.max(0, index - 1)
                      : null
            if (target === null) return
            event.preventDefault()
            onSelect(target)
            buttons.current[target]?.focus({ preventScroll: true })
          }}
        >
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full transition-colors ${selected === index ? "bg-foreground" : "bg-muted-foreground/35"}`}
          />
        </Button>
      ))}
    </nav>
  )
}
