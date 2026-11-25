import { invoke } from "@tauri-apps/api/core"
import { ArrowUp } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { client } from "@/lib/client"

import { type Pointed, pointedContext, remarkPlace } from "./point"
import { prepareBrowserChat } from "./quick-chat-session"
import { useBrowserQuickChat } from "./quick-chat-state"

/** The size of the box a remark is written in, in CSS pixels. */
const remarkBox = { width: 320, height: 44 }

/**
 * Lets a person point at something on the page and say one thing about it. The remark goes to the
 * browser's conversation at once, with what was pointed at; the page itself receives nothing while
 * this is shown.
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
  const [chosen, setChosen] = useState<Pointed | null>(null)
  const [remark, setRemark] = useState("")
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
    void ask(x, y, true)
      .then((answer) => {
        if (closed.current) return
        setChosen(answer)
        setRemark("")
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

  const send = async () => {
    const words = remark.trim()
    if (!chosen || !words || sending) return
    setSending(true)
    try {
      await prepareBrowserChat()
      const sessionId = useBrowserQuickChat.getState().sessionId
      if (sessionId === null) throw Error("Browser conversation is unavailable")
      await client.prompt(sessionId, [
        { type: "text", text: words },
        // Attached context: the person sees its first line, the conversation reads all of it.
        {
          type: "resource",
          resource: {
            uri: url,
            mimeType: "text/plain",
            text: pointedContext(chosen, { url, tab: label, selection: selection.current }, t)
          }
        }
      ])
      useBrowserQuickChat.setState({ revealSessionId: sessionId })
      onClose()
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure))
      setSending(false)
    }
  }

  const shown = chosen ?? hovered
  const place =
    chosen &&
    frame.width > 0 &&
    remarkPlace(chosen.rect, {
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
        if (chosen) return
        next.current = at(event)
        void follow()
      }}
      onPointerLeave={() => {
        next.current = null
        if (!chosen) setHovered(null)
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || sending || event.target !== event.currentTarget) return
        event.preventDefault()
        const { x, y } = at(event)
        selection.current = undefined
        choose(x, y)
      }}
      onWheel={(event) => {
        // What was chosen stays where it was outlined: the page does not move under a remark being written.
        if (chosen || event.target !== event.currentTarget) return
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
        if (chosen) setChosen(null)
        else onClose()
      }}
    >
      {shown && (
        <div
          data-browser-pointed
          className="pointer-events-none absolute rounded-sm bg-ring/15 ring-2 ring-ring"
          style={{
            left: `${shown.rect[0] * 100}%`,
            top: `${shown.rect[1] * 100}%`,
            width: `${shown.rect[2] * 100}%`,
            height: `${shown.rect[3] * 100}%`
          }}
        />
      )}
      {place && (
        <form
          className="absolute flex items-center gap-1 rounded-full border bg-popover p-1 shadow-lg"
          style={{
            left: `${place.left * 100}%`,
            top: `calc(${place.top * 100}% + 8px)`,
            width: Math.min(remarkBox.width, frame.width),
            height: remarkBox.height
          }}
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <Input
            autoFocus
            value={remark}
            disabled={sending}
            aria-label={t("browser.pointSay")}
            placeholder={t("browser.pointSay")}
            onChange={(event) => setRemark(event.target.value)}
            className="h-8 min-w-0 flex-1 border-0 bg-transparent px-2 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
          />
          <Button
            type="submit"
            size="icon-sm"
            className="rounded-full"
            aria-label={t("browser.pointSend")}
            disabled={sending || remark.trim() === ""}
          >
            <ArrowUp />
          </Button>
        </form>
      )}
    </div>
  )
}
