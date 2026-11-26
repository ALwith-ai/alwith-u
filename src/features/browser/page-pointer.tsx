import { type DraftPort, RevisionDraft } from "@alwith/module-voice/chat"
import { invoke } from "@tauri-apps/api/core"
import { ArrowUp } from "lucide-react"
import { type CSSProperties, type PointerEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { VoiceButton } from "@/features/voice/voice-button"
import { errorMessage, logBackgroundError } from "@/lib/background-errors"
import { client } from "@/lib/client"

import { type Pointed, pointedContext, regionContext, remarkPlace } from "./point"
import { prepareBrowserChat } from "./quick-chat-session"
import { useBrowserQuickChat } from "./quick-chat-state"

/** The size of the box a remark is written in, in CSS pixels. */
const remarkBox = { width: 320, height: 44 }
const dragThreshold = 4

type Chosen = { revision: number } & (
  { kind: "point"; point: Pointed } | { kind: "region"; rect: Pointed["rect"]; url: string }
)

interface Gesture {
  pointerId: number
  start: { x: number; y: number }
  clientX: number
  clientY: number
  dragging: boolean
}

async function remarkDirectory() {
  return useBrowserQuickChat.getState().cwd ?? (await client.refreshProjectContext(true)).chatDirectory
}

function RemarkInput({
  style,
  sending,
  onSend
}: {
  style: CSSProperties
  sending: boolean
  onSend: (text: string) => void
}) {
  const { t } = useTranslation()
  const target = useId()
  const input = useRef<HTMLInputElement>(null)
  const cancelVoice = useRef<(() => void) | null>(null)
  const [revision] = useState(() => new RevisionDraft(target, "", [0, 0]))
  const [text, setText] = useState("")
  const nextSelection = useRef<readonly [number, number] | null>(null)
  const [draft] = useState<DraftPort>(() => ({
    read: () => revision.read(),
    compareAndSet: (expected, value, selection) => {
      const updated = revision.compareAndSet(expected, value, selection)
      if (updated) {
        nextSelection.current = selection
        setText(value)
      }
      return updated
    }
  }))
  useLayoutEffect(() => {
    const selection = nextSelection.current
    nextSelection.current = null
    if (selection) input.current?.setSelectionRange(...selection)
  }, [text])

  return (
    <form
      className="absolute flex items-center gap-1 rounded-full border bg-popover p-1 shadow-lg"
      style={style}
      onSubmit={(event) => {
        event.preventDefault()
        const words = revision.read().text.trim()
        if (sending || words === "") return
        cancelVoice.current?.()
        onSend(words)
      }}
    >
      <Input
        ref={input}
        autoFocus
        value={text}
        disabled={sending}
        aria-label={t("browser.pointSay")}
        placeholder={t("browser.pointSay")}
        onChange={({ currentTarget }) => {
          const { value, selectionStart, selectionEnd } = currentTarget
          revision.edit(value, [selectionStart ?? value.length, selectionEnd ?? value.length])
          setText(value)
        }}
        onSelect={({ currentTarget }) => {
          const { value, selectionStart, selectionEnd } = currentTarget
          const current = revision.read()
          if (current.text !== value || selectionStart === null || selectionEnd === null) return
          if (current.selection[0] !== selectionStart || current.selection[1] !== selectionEnd) {
            revision.edit(value, [selectionStart, selectionEnd])
          }
        }}
        className="h-8 min-w-0 flex-1 border-0 bg-transparent px-2 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
      />
      <VoiceButton draft={draft} cwd={remarkDirectory} enabled={!sending} cancelRef={cancelVoice} dictationOnly />
      <Button
        type="submit"
        size="icon-sm"
        className="rounded-full"
        aria-label={t("browser.pointSend")}
        disabled={sending || text.trim() === ""}
      >
        <ArrowUp />
      </Button>
    </form>
  )
}

/**
 * Lets a person point at something on the page and say one thing about it. The remark goes to the
 * browser's conversation with the selected element or region.
 */
export function PagePointer({
  label,
  surface,
  url,
  start,
  onClose
}: {
  /** The guest that shows the page. */
  label: string
  /** The element the page is drawn in; this lies exactly over it. */
  surface: HTMLElement
  url: string
  /** The point the person already chose, as fractions of the page's visible area, and the text they had selected. */
  start?: { x: number; y: number; selection?: string }
  onClose: () => void
}) {
  const { t } = useTranslation()
  const layer = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState({ left: 0, top: 0, width: 0, height: 0 })
  const [hovered, setHovered] = useState<Pointed | null>(null)
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const [dragRect, setDragRect] = useState<Pointed["rect"] | null>(null)
  const chosenRevision = useRef(0)
  const regionRevision = useRef(0)
  const [sending, setSending] = useState(false)
  // One question to the page at a time; the newest point waits for the answer to the one before.
  const asking = useRef(false)
  const next = useRef<{ x: number; y: number } | null>(null)
  const closed = useRef(false)
  // The turns of the wheel not yet passed to the page, and where the pointer was for the last one.
  const turned = useRef<{ x: number; y: number; deltaX: number; deltaY: number } | null>(null)
  const turning = useRef(false)

  useLayoutEffect(() => {
    const place = () =>
      setFrame({
        left: surface.offsetLeft,
        top: surface.offsetTop,
        width: surface.offsetWidth,
        height: surface.offsetHeight
      })
    place()
    const observer = new ResizeObserver(place)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [surface])

  useEffect(() => {
    // The page holds the keyboard until the application takes it back.
    layer.current?.focus({ preventScroll: true })
    // Development mounts an effect twice: the second mount is open again.
    closed.current = false
    return () => {
      closed.current = true
    }
  }, [])

  const ask = (x: number, y: number, describe: boolean) =>
    invoke<Pointed | null>("cef_guest_point", { label, x, y, describe })

  const choose = (x: number, y: number) => {
    next.current = null
    const region = regionRevision.current
    void ask(x, y, true)
      .then((answer) => {
        if (closed.current || region !== regionRevision.current) return
        setChosen(answer ? { kind: "point", point: answer, revision: ++chosenRevision.current } : null)
      })
      .catch((failure: unknown) => toast.error(String(failure)))
  }
  // The text that was selected when pointing started from the page's menu; pointing again lets go of it.
  const selection = useRef(start?.selection)
  // A point chosen from the page's menu is chosen here from the start.
  const started = useRef(false)
  useEffect(() => {
    if (!start || started.current) return
    started.current = true
    choose(start.x, start.y)
  })

  // The page scrolls under the pointer as it would without this over it; what is outlined follows.
  const turn = async () => {
    if (turning.current) return
    turning.current = true
    try {
      while (turned.current && !closed.current) {
        const { x, y, deltaX, deltaY } = turned.current
        turned.current = null
        await invoke("cef_guest_wheel", { label, x, y, deltaX, deltaY })
        next.current = { x, y }
      }
    } catch {
      // A page that is navigating scrolls nothing.
    } finally {
      turning.current = false
    }
    void follow()
  }

  const follow = async () => {
    if (asking.current) return
    asking.current = true
    try {
      while (next.current && !closed.current) {
        const { x, y } = next.current
        next.current = null
        const answer = await ask(x, y, false)
        if (!closed.current) setHovered(answer)
      }
    } catch {
      // A page that is navigating answers nothing; the next movement asks again.
      if (!closed.current) setHovered(null)
    } finally {
      asking.current = false
    }
  }

  const at = (event: { clientX: number; clientY: number }) => {
    const bounds = layer.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
    }
  }

  const dragAt = (press: Gesture, event: PointerEvent<HTMLDivElement>): Pointed["rect"] | null => {
    if (!press.dragging) {
      if (Math.max(Math.abs(event.clientX - press.clientX), Math.abs(event.clientY - press.clientY)) < dragThreshold) {
        return null
      }
      press.dragging = true
    }
    const { x, y } = at(event)
    return [
      Math.min(press.start.x, x),
      Math.min(press.start.y, y),
      Math.abs(press.start.x - x),
      Math.abs(press.start.y - y)
    ]
  }

  const cancelGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointerId !== event.pointerId) return
    gesture.current = null
    setDragRect(null)
  }

  const send = async (words: string) => {
    if (!chosen || sending) return
    setSending(true)
    let operation = chosen.kind === "region" ? "capture-region" : "prepare-chat"
    try {
      const pageUrl = chosen.kind === "region" ? chosen.url : url
      const screenshot =
        chosen.kind === "region"
          ? await invoke<string>("cef_guest_region_screenshot", { label, url: pageUrl, rect: chosen.rect })
          : null
      operation = "prepare-chat"
      await prepareBrowserChat()
      const sessionId = useBrowserQuickChat.getState().sessionId
      if (sessionId === null) throw Error("Browser conversation is unavailable")
      operation = "prompt"
      await client.prompt(sessionId, [
        { type: "text", text: words },
        // Attached context: the person sees its first line, the conversation reads all of it.
        {
          type: "resource",
          resource: {
            uri: pageUrl,
            mimeType: "text/plain",
            text:
              chosen.kind === "region"
                ? regionContext(chosen.rect, { url: pageUrl, tab: label }, t("browser.pointRegionLabel"))
                : pointedContext(chosen.point, { url, tab: label, selection: selection.current }, t)
          }
        },
        ...(screenshot === null ? [] : [{ type: "image" as const, mimeType: "image/png", data: screenshot }])
      ])
      if (!closed.current) {
        setChosen(null)
        setHovered(null)
        layer.current?.focus({ preventScroll: true })
      }
    } catch (failure) {
      logBackgroundError(`browser/annotation/${operation}`, failure)
      toast.error(errorMessage(failure))
    } finally {
      if (!closed.current) setSending(false)
    }
  }

  const chosenRect = chosen?.kind === "point" ? chosen.point.rect : chosen?.rect
  const shown = dragRect ?? chosenRect ?? hovered?.rect
  const place =
    chosenRect &&
    frame.width > 0 &&
    remarkPlace(chosenRect, {
      width: Math.min(1, remarkBox.width / frame.width),
      height: Math.min(1, (remarkBox.height + 8) / frame.height)
    })
  return (
    <div
      ref={layer}
      tabIndex={-1}
      role="application"
      aria-label={t("browser.point")}
      data-browser-pointer
      className="absolute z-20 cursor-pointer outline-none"
      style={frame}
      onPointerMove={(event) => {
        const press = gesture.current
        if (press) {
          if (press.pointerId === event.pointerId) {
            const wasDragging = press.dragging
            const rect = dragAt(press, event)
            if (rect) {
              if (!wasDragging) event.currentTarget.focus({ preventScroll: true })
              setDragRect(rect)
            }
          }
          return
        }
        if (chosen) return
        next.current = at(event)
        void follow()
      }}
      onPointerLeave={() => {
        next.current = null
        if (!chosen) setHovered(null)
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || sending || gesture.current || event.target !== event.currentTarget) return
        event.preventDefault()
        const { pointerId, clientX, clientY } = event
        gesture.current = { pointerId, clientX, clientY, start: at(event), dragging: false }
        event.currentTarget.setPointerCapture(pointerId)
        next.current = null
      }}
      onPointerUp={(event) => {
        const press = gesture.current
        if (!press || press.pointerId !== event.pointerId) return
        gesture.current = null
        setDragRect(null)
        const rect = dragAt(press, event)
        if (rect && (rect[2] === 0 || rect[3] === 0)) return
        selection.current = undefined
        if (rect) {
          regionRevision.current += 1
          setChosen({ kind: "region", rect, url, revision: ++chosenRevision.current })
        } else choose(press.start.x, press.start.y)
      }}
      onPointerCancel={cancelGesture}
      onLostPointerCapture={cancelGesture}
      onWheel={(event) => {
        // What was chosen stays where it was outlined: the page does not move under a remark being written.
        if (chosen || gesture.current || event.target !== event.currentTarget) return
        const { x, y } = at(event)
        const before = turned.current
        turned.current = {
          x,
          y,
          deltaX: (before?.deltaX ?? 0) + event.deltaX,
          deltaY: (before?.deltaY ?? 0) + event.deltaY
        }
        void turn()
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        if (gesture.current) {
          const { pointerId } = gesture.current
          gesture.current = null
          setDragRect(null)
          if (event.currentTarget.hasPointerCapture(pointerId)) event.currentTarget.releasePointerCapture(pointerId)
          return
        }
        if (chosen) {
          setChosen(null)
          layer.current?.focus({ preventScroll: true })
        } else onClose()
      }}
    >
      {shown && (
        <div
          data-browser-pointed
          className="pointer-events-none absolute rounded-sm bg-ring/15 ring-2 ring-ring"
          style={{
            left: `${shown[0] * 100}%`,
            top: `${shown[1] * 100}%`,
            width: `${shown[2] * 100}%`,
            height: `${shown[3] * 100}%`
          }}
        />
      )}
      {chosen && place && (
        <RemarkInput
          key={chosen.revision}
          style={{
            left: `${place.left * 100}%`,
            top: `calc(${place.top * 100}% + 8px)`,
            width: Math.min(remarkBox.width, frame.width),
            height: remarkBox.height
          }}
          sending={sending}
          onSend={(words) => void send(words)}
        />
      )}
    </div>
  )
}
