import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LoaderCircleIcon,
  MonitorIcon,
  SquareIcon
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import type { ComputerPreview_Serialize } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

import { computerActionKey } from "./action-label"
import { AgentCursor } from "./agent-cursor"
import { cursorArtwork } from "./cursor-artwork"

function WindowFrame({ preview }: { preview: ComputerPreview_Serialize }) {
  const { t } = useTranslation()
  const frame = preview.frame
  if (!frame)
    return (
      <div
        role="status"
        className="flex min-h-40 flex-col items-center justify-center gap-3 text-xs text-muted-foreground"
      >
        <MonitorIcon className="size-7 opacity-40" />
        <span>{t(preview.error ? "computer.preview.unavailable" : "computer.preview.waiting")}</span>
      </div>
    )
  return (
    <div className="relative mx-auto w-fit max-w-full">
      <img
        src={frame.image}
        alt={t("computer.preview.frame", { title: frame.title })}
        className="block max-h-[55vh] max-w-full object-contain"
      />
      {frame.cursor && (
        <span
          className="pointer-events-none absolute z-10"
          style={{
            left: `${frame.cursor.x * 100}%`,
            top: `${frame.cursor.y * 100}%`,
            transform: `translate(${(-cursorArtwork.hotspot[0] * cursorArtwork.size) / cursorArtwork.canvas}px, ${(-cursorArtwork.hotspot[1] * cursorArtwork.size) / cursorArtwork.canvas}px)`
          }}
        >
          <AgentCursor />
        </span>
      )}
    </div>
  )
}

export function ComputerPreviewCard({
  preview,
  stopping,
  onStop,
  onFocus
}: {
  preview: ComputerPreview_Serialize
  stopping: boolean
  onStop: () => void
  onFocus: () => void
}) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const queued = preview.activity.phase === "queued"
  const title = preview.frame?.appName || t("computer.preview.active")
  return (
    <section
      aria-label={t("computer.preview.title")}
      className="computer-preview ml-auto w-full max-w-72 shrink-0 px-3 py-2"
    >
      <div className="group/preview relative ml-auto w-full max-w-72 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
        <div
          className={cn(
            "z-20 flex items-center gap-1 bg-card/65 px-2 py-1.5 backdrop-blur-xl transition-opacity motion-reduce:transition-none",
            !queued &&
              !collapsed &&
              preview.frame &&
              "absolute inset-x-0 top-0 opacity-0 group-focus-within/preview:opacity-100 group-hover/preview:opacity-100 hover:opacity-100 [@media(hover:none)]:opacity-100"
          )}
        >
          <MonitorIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span role="status" className="min-w-0 flex-1 truncate text-xs">
            {queued ? t("computer.preview.queued", { position: preview.activity.queuePosition }) : title}
          </span>
          {!queued && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t(collapsed ? "computer.preview.expand" : "computer.preview.collapse")}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((v) => !v)}
            >
              {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
            </Button>
          )}
          {!queued && preview.frame && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("computer.preview.enlarge")}
              onClick={() => setExpanded(true)}
            >
              <ArrowUpRightIcon />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={stopping}
            onClick={onStop}
            aria-label={t(queued ? "computer.preview.cancelQueue" : "computer.preview.stop")}
          >
            {stopping ? <LoaderCircleIcon className="motion-safe:animate-spin" /> : <SquareIcon />}
          </Button>
        </div>
        {!queued && !collapsed && (
          <Button
            variant="ghost"
            className="block h-auto w-full overflow-hidden rounded-none bg-muted/40 p-0 hover:bg-muted/40 [&_img]:max-h-44"
            disabled={!preview.frame || !preview.activity.target}
            aria-label={t("computer.preview.focus", { app: title })}
            title={t("computer.preview.focus", { app: title })}
            onClick={onFocus}
          >
            <WindowFrame preview={preview} />
          </Button>
        )}
      </div>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{preview.frame?.title || t("computer.preview.live")}</DialogDescription>
          </DialogHeader>
          <Button
            variant="ghost"
            className="h-auto overflow-hidden rounded-xl border bg-muted/30 p-0"
            onClick={onFocus}
            aria-label={t("computer.preview.focus", { app: title })}
          >
            <WindowFrame preview={preview} />
          </Button>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{t(computerActionKey(preview.activity.action))}</span>
            <Button variant="outline" size="sm" disabled={stopping} onClick={onStop}>
              <SquareIcon />
              {t("computer.preview.stop")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
