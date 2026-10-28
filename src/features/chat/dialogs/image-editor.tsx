import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  EraserIcon,
  GripVerticalIcon,
  LoaderCircleIcon,
  PencilIcon,
  Redo2Icon,
  ScanIcon,
  SquareIcon,
  Undo2Icon,
  UnfoldHorizontalIcon,
  XIcon
} from "lucide-react"
import { type PointerEvent, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"

import {
  type EditMode,
  IMAGE_ASPECT_RATIOS,
  type ImageAspectRatio,
  imageEditPrompt,
  imagePoint,
  type Point,
  renderImageEdit,
  type Stroke,
  strokePath
} from "./image-edit"

// These swatches represent annotation content, independent of the interface theme.
const ANNOTATION_COLORS = [
  { name: "red", value: "#ef4444" },
  { name: "orange", value: "#f97316" },
  { name: "yellow", value: "#eab308" },
  { name: "green", value: "#16a34a" },
  { name: "blue", value: "#2563eb" },
  { name: "purple", value: "#9333ea" },
  { name: "black", value: "#171717" },
  { name: "white", value: "#ffffff" }
] as const

type SendImageEdit = (prompt: acp.ContentBlock[]) => Promise<void>

export function useImageEditor(
  source: string,
  natural: { width: number; height: number },
  onSend: SendImageEdit | undefined,
  onClose: () => void,
  onSendingChange?: (sending: boolean) => void,
  externalSending = false
) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<EditMode | null>(null)
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0].value)
  const [tool, setTool] = useState<Stroke["tool"]>("pen")
  const [annotations, setAnnotations] = useState<Stroke[]>([])
  const [erasures, setErasures] = useState<Stroke[]>([])
  const [annotationRedo, setAnnotationRedo] = useState<Stroke[]>([])
  const [erasureRedo, setErasureRedo] = useState<Stroke[]>([])
  const [instruction, setInstruction] = useState("")
  const [penWidth, setPenWidth] = useState(0.006)
  const [eraserWidth, setEraserWidth] = useState(0.04)
  const [localSending, setSending] = useState(false)
  const sending = localSending || externalSending
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const overlay = useRef<SVGSVGElement>(null)
  const active = useRef<{ pointer: number; stroke: Stroke } | null>(null)
  const [draft, setDraft] = useState<Stroke | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)
  const strokes = mode === "erase" ? erasures : annotations
  const setStrokes = mode === "erase" ? setErasures : setAnnotations
  const undone = mode === "erase" ? erasureRedo : annotationRedo
  const setUndone = mode === "erase" ? setErasureRedo : setAnnotationRedo
  const brush = mode === "erase" ? eraserWidth : penWidth
  const setBrush = mode === "erase" ? setEraserWidth : setPenWidth
  const drawing = mode === "annotate" || mode === "erase"
  const available = onSend !== undefined && /^data:image\/[^;,]+;base64,/.test(source)
  const canSend =
    available &&
    drawing &&
    !sending &&
    !draft &&
    strokes.length > 0 &&
    (mode !== "annotate" || instruction.trim().length > 0)
  const select = (next: EditMode | null): void => {
    if (sending || pending.current) return
    active.current = null
    setDraft(null)
    setCursor(null)
    setError(null)
    setMode(next)
  }
  const undo = (): void => {
    if (sending || draft || !strokes.length) return
    setUndone([...undone, strokes.at(-1)!])
    setStrokes(strokes.slice(0, -1))
  }
  const redo = (): void => {
    if (sending || draft || !undone.length) return
    setStrokes([...strokes, undone.at(-1)!])
    setUndone(undone.slice(0, -1))
  }
  const send = async (nextMode: EditMode | null = mode, aspectRatio?: ImageAspectRatio): Promise<void> => {
    if (!available || sending || pending.current || !onSend || !nextMode || draft) return
    const isDrawing = nextMode === "annotate" || nextMode === "erase"
    if (isDrawing && !canSend) return
    pending.current = true
    setMode(nextMode)
    setSending(true)
    onSendingChange?.(true)
    setError(null)
    try {
      let reference: string | undefined
      if (isDrawing) {
        const selection = overlay.current
        if (!selection) throw new Error("Image selection is unavailable")
        reference = await renderImageEdit(source, strokes, nextMode === "erase")
      }
      await onSend(
        imageEditPrompt({
          mode: nextMode,
          source,
          overlay: reference,
          instruction: nextMode === "annotate" ? instruction : "",
          aspectRatio,
          operationText: t(`chat.image.edit.prompts.${nextMode}`, { ratio: aspectRatio })
        })
      )
      onSendingChange?.(false)
      onClose()
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      pending.current = false
      onSendingChange?.(false)
      setSending(false)
    }
  }
  const point = (event: PointerEvent<SVGSVGElement>): Point =>
    imagePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
  const pointerDown = (event: PointerEvent<SVGSVGElement>): void => {
    if (sending || !drawing || active.current || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const position = point(event)
    const stroke: Stroke = { tool: mode === "erase" ? "pen" : tool, points: [position], width: brush, color }
    active.current = { pointer: event.pointerId, stroke }
    setCursor(position)
    setDraft(stroke)
  }
  const pointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    const next = point(event)
    setCursor(next)
    const current = active.current
    if (!current || current.pointer !== event.pointerId) return
    current.stroke = {
      ...current.stroke,
      points: current.stroke.tool === "pen" ? [...current.stroke.points, next] : [current.stroke.points[0], next]
    }
    setDraft(current.stroke)
  }
  const pointerEnd = (event: PointerEvent<SVGSVGElement>, cancel = false): void => {
    const current = active.current
    if (!current || current.pointer !== event.pointerId) return
    if (!cancel) {
      pointerMove(event)
      setStrokes((previous) => [...previous, current.stroke])
      setUndone([])
    }
    active.current = null
    setDraft(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return {
    mode,
    select,
    tool,
    setTool,
    color,
    setColor,
    strokes,
    draft,
    undone,
    undo,
    redo,
    drawing,
    overlay,
    pointerDown,
    pointerMove,
    pointerEnd,
    cursor,
    setCursor,
    instruction,
    setInstruction,
    brush,
    setBrush,
    sending,
    error,
    send,
    canSend,
    available,
    natural
  }
}

type ImageEditor = ReturnType<typeof useImageEditor>

export function ImageEditOverlay({ editor }: { editor: ImageEditor }) {
  const { t } = useTranslation()
  if (!editor.drawing || !editor.natural.width || !editor.natural.height) return null
  const { width, height } = editor.natural
  return (
    <svg
      ref={editor.overlay}
      viewBox={`0 0 ${width} ${height}`}
      className={`absolute inset-0 size-full touch-none ${editor.mode === "erase" ? "text-muted-foreground" : "text-destructive"}`}
      style={{ cursor: editor.sending ? "wait" : editor.mode === "erase" ? "none" : "crosshair" }}
      role="img"
      aria-label={t("chat.image.edit.selection")}
      onPointerDown={editor.pointerDown}
      onPointerMove={editor.pointerMove}
      onPointerUp={(event) => editor.pointerEnd(event)}
      onPointerLeave={() => editor.setCursor(null)}
      onPointerCancel={(event) => editor.pointerEnd(event, true)}
      onLostPointerCapture={(event) => editor.pointerEnd(event, true)}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={editor.mode === "erase" ? 0.4 : 1}
      >
        {[...editor.strokes, ...(editor.draft ? [editor.draft] : [])].map((stroke, index) => (
          <path
            key={index}
            d={strokePath(stroke, width, height)}
            stroke={editor.mode === "erase" ? "currentColor" : stroke.color}
            strokeWidth={stroke.width * Math.min(width, height)}
          />
        ))}
      </g>
      {editor.mode === "erase" && editor.cursor && !editor.sending && (
        <circle
          pointerEvents="none"
          cx={editor.cursor.x * width}
          cy={editor.cursor.y * height}
          r={(editor.brush * Math.min(width, height)) / 2}
          fill="currentColor"
          opacity={0.25}
        />
      )}
    </svg>
  )
}

export function ImageEditToolbar({ editor }: { editor: ImageEditor }) {
  const { t } = useTranslation()
  const [colorOpen, setColorOpen] = useState(false)
  if (!editor.available) return null
  const iconButton =
    "h-8 gap-1.5 rounded-lg px-2 text-[13px] font-normal text-foreground/70 hover:bg-foreground/10 hover:text-foreground [&_svg:not([class*='size-'])]:size-3.5"
  const cancel = (
    <Button
      variant="ghost"
      size="icon-sm"
      className={iconButton}
      aria-label={t("chat.image.edit.cancel")}
      title={t("chat.image.edit.cancel")}
      disabled={editor.sending}
      onClick={() => editor.select(null)}
    >
      <XIcon />
    </Button>
  )
  return (
    <footer className="relative flex w-full shrink-0 flex-col items-center gap-3 px-4 pt-2 pb-4">
      {editor.error && (
        <p role="alert" className="max-w-xl rounded-xl border bg-background px-4 py-2 text-sm text-destructive">
          {editor.error}
        </p>
      )}
      {editor.drawing && (
        <div className="absolute start-4 bottom-[35vh] flex h-52 items-center justify-center rounded-full border bg-background px-3 py-4 shadow-md">
          <Input
            type="range"
            min="0.2"
            max="20"
            step="0.2"
            aria-label={t("chat.image.edit.brushSize")}
            value={editor.brush * 100}
            disabled={editor.sending}
            onChange={(event) => editor.setBrush(Number(event.target.value) / 100)}
            className="h-44 w-5 cursor-pointer border-0 p-0 accent-foreground shadow-none"
            style={{ writingMode: "vertical-lr", direction: "rtl" }}
          />
        </div>
      )}
      <div
        className="dark flex max-w-full items-center gap-0.5 rounded-xl bg-muted p-1 text-foreground shadow-lg"
        role="toolbar"
        aria-label={t("chat.image.edit.tools")}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
            event.preventDefault()
            if (event.shiftKey) editor.redo()
            else editor.undo()
          }
        }}
      >
        <GripVerticalIcon aria-hidden className="mx-0.5 size-3.5 shrink-0 text-muted-foreground" />
        {editor.mode === "annotate" ? (
          <>
            {(
              [
                ["pen", PencilIcon],
                ["rectangle", SquareIcon],
                ["arrow", ArrowUpRightIcon]
              ] as const
            ).map(([tool, Icon]) => (
              <Button
                key={tool}
                variant="ghost"
                size="icon-sm"
                className={`${iconButton} data-[active=true]:bg-foreground/10`}
                data-active={editor.tool === tool}
                aria-pressed={editor.tool === tool}
                aria-label={t(`chat.image.edit.${tool}`)}
                title={t(`chat.image.edit.${tool}`)}
                disabled={editor.sending}
                onClick={() => editor.setTool(tool)}
              >
                <Icon />
              </Button>
            ))}
            <Popover open={colorOpen && !editor.sending} onOpenChange={setColorOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={iconButton}
                    aria-label={t("chat.image.edit.color")}
                    title={t("chat.image.edit.color")}
                    disabled={editor.sending}
                  />
                }
              >
                <span
                  aria-hidden
                  className="size-4 rounded-full ring-1 ring-foreground/20"
                  style={{ backgroundColor: editor.color }}
                />
              </PopoverTrigger>
              <PopoverContent side="top" sideOffset={6} className="w-auto rounded-xl p-1.5">
                <div
                  role="radiogroup"
                  aria-label={t("chat.image.edit.color")}
                  className="grid grid-cols-4 gap-1"
                  onKeyDown={(event) => {
                    if (editor.sending) return
                    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }
                    const offset = offsets[event.key]
                    if (offset === undefined) return
                    event.preventDefault()
                    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
                    const index = buttons.findIndex((button) => button === event.target)
                    if (index < 0) return
                    const next = (index + offset + ANNOTATION_COLORS.length) % ANNOTATION_COLORS.length
                    editor.setColor(ANNOTATION_COLORS[next].value)
                    buttons[next].focus()
                  }}
                >
                  {ANNOTATION_COLORS.map((color) => (
                    <Button
                      key={color.value}
                      variant="ghost"
                      size="icon-xs"
                      className="rounded-full"
                      role="radio"
                      tabIndex={editor.color === color.value ? 0 : -1}
                      aria-checked={editor.color === color.value}
                      aria-label={t(`chat.image.edit.colors.${color.name}`)}
                      title={t(`chat.image.edit.colors.${color.name}`)}
                      disabled={editor.sending}
                      onClick={() => {
                        editor.setColor(color.value)
                        setColorOpen(false)
                      }}
                    >
                      <span
                        aria-hidden
                        className={`size-4 rounded-full border border-foreground/20 ${editor.color === color.value ? "ring-2 ring-ring ring-offset-2 ring-offset-popover" : ""}`}
                        style={{ backgroundColor: color.value }}
                      />
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <span aria-hidden className="mx-1 h-5 border-s border-foreground/15" />
            <Button
              variant="ghost"
              size="icon-sm"
              className={iconButton}
              aria-label={t("chat.image.edit.undo")}
              title={t("chat.image.edit.undo")}
              disabled={!editor.strokes.length || editor.sending}
              onClick={editor.undo}
            >
              <Undo2Icon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className={iconButton}
              aria-label={t("chat.image.edit.redo")}
              title={t("chat.image.edit.redo")}
              disabled={!editor.undone.length || editor.sending}
              onClick={editor.redo}
            >
              <Redo2Icon />
            </Button>
            <span aria-hidden className="mx-1 h-5 border-s border-foreground/15" />
            {cancel}
          </>
        ) : editor.mode === "erase" ? (
          <>
            <span className="px-2 text-[13px] text-muted-foreground">{t("chat.image.edit.eraseHint")}</span>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full bg-foreground/15 px-3 text-[13px] font-normal hover:bg-foreground/25"
              disabled={!editor.canSend}
              onClick={() => void editor.send()}
            >
              {editor.sending && <LoaderCircleIcon className="animate-spin" />}
              {t("actions.send")}
            </Button>
            {cancel}
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              className={iconButton}
              disabled={editor.sending}
              onClick={() => editor.select("annotate")}
            >
              <PencilIcon />
              {t("chat.image.edit.annotate")}
            </Button>
            <Button
              variant="ghost"
              className={iconButton}
              disabled={editor.sending}
              onClick={() => void editor.send("background")}
            >
              {editor.sending && editor.mode === "background" ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <ScanIcon />
              )}
              {t("chat.image.edit.background")}
            </Button>
            <Button
              variant="ghost"
              className={iconButton}
              disabled={editor.sending}
              onClick={() => editor.select("erase")}
            >
              <EraserIcon />
              {t("chat.image.edit.erase")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" className={iconButton} disabled={editor.sending} />}>
                <UnfoldHorizontalIcon />
                {t("chat.image.edit.resize")}
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="end" sideOffset={6} className="w-40 min-w-40 rounded-xl p-1">
                {IMAGE_ASPECT_RATIOS.map((ratio) => (
                  <DropdownMenuItem
                    key={ratio.value}
                    className="h-7 gap-2.5 rounded-md px-2.5 py-1 text-[13px] font-normal"
                    onClick={() => void editor.send("resize", ratio.value)}
                  >
                    <span className="flex size-4 items-center justify-center" aria-hidden>
                      <span
                        className="block rounded-[3px] border border-current"
                        style={{
                          aspectRatio: ratio.value.replace(":", "/"),
                          ...(Number(ratio.value.split(":")[0]) >= Number(ratio.value.split(":")[1])
                            ? { width: 14 }
                            : { height: 16 })
                        }}
                      />
                    </span>
                    <span className="flex-1">{t(`chat.image.edit.ratios.${ratio.label}`)}</span>
                    <span className="text-muted-foreground">{ratio.value}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
      {editor.mode === "annotate" && (
        <form
          className="flex w-full max-w-3xl items-end gap-2 rounded-3xl border bg-background p-1.5 ps-4 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault()
            void editor.send()
          }}
        >
          <Textarea
            aria-label={t("chat.image.edit.instructions")}
            placeholder={t("chat.image.edit.addDescription")}
            value={editor.instruction}
            disabled={editor.sending}
            onChange={(event) => editor.setInstruction(event.target.value)}
            rows={1}
            className="max-h-28 min-h-8 resize-none rounded-none border-0 bg-transparent px-0 py-1 leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void editor.send()
              }
            }}
          />
          <Button
            type="submit"
            size="icon-sm"
            className="shrink-0 rounded-full"
            aria-label={t("actions.send")}
            title={t("actions.send")}
            disabled={!editor.canSend}
          >
            {editor.sending ? <LoaderCircleIcon className="animate-spin" /> : <ArrowUpIcon />}
          </Button>
        </form>
      )}
    </footer>
  )
}
