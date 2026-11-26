import { type Session } from "@alwith/module-chat/client"
import { ConversationView } from "@alwith/module-chat/conversation"
import { RUN_STATE_COLOR, SessionStateDot } from "@alwith/module-chat/session-list"
import { ChevronDown, GripVertical, MessageCircle, Plus } from "lucide-react"
import { memo, type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { ChatBranchProvider } from "@/features/chat/chat-branches"
import { useChatHost, useTimelineSlots } from "@/features/chat/chat-host"
import { ChatComposer } from "@/features/chat/composer"
import { MainInputModeProvider } from "@/features/chat/composer/input-mode"
import { FilePreviewModal } from "@/features/chat/dialogs/file-preview-modal"
import { ChatDirectoryContext } from "@/features/chat/file-actions"
import { client, useApp, useSession } from "@/lib/client"
import { useReadVisibleSession } from "@/lib/use-read-visible-session"
import { cn } from "@/lib/utils"
import { useWindowFocus } from "@/lib/window-focus"

import {
  nearestQuickChatCorner,
  type Point,
  quickChatAnchor,
  quickChatDefault,
  quickChatSize,
  resizeQuickChat,
  type Size
} from "./quick-chat-geometry"
import { prepareBrowserChat } from "./quick-chat-session"
import { useBrowserQuickChat } from "./quick-chat-state"
import "./browser-quick-chat.css"

const BrowserConversation = memo(function BrowserConversation({
  session,
  disabled
}: {
  session: Session
  disabled: boolean
}) {
  const { t } = useTranslation()
  const host = useChatHost(session.id)
  const timeline = useTimelineSlots(session.readOnly ? undefined : session.id)
  return (
    <MainInputModeProvider sessionId={session.id} draft={false}>
      <ChatBranchProvider session={session}>
        <ChatDirectoryContext value={session.cwd}>
          <ConversationView
            session={session}
            client={client}
            host={host}
            timeline={timeline}
            search={false}
            welcome={
              <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                {t("browser.quickChat.welcome")}
              </div>
            }
            composer={<ChatComposer session={session} inputDisabled={disabled} />}
          >
            <FilePreviewModal />
          </ConversationView>
        </ChatDirectoryContext>
      </ChatBranchProvider>
    </MainInputModeProvider>
  )
})

interface Gesture {
  pointer: number
  start: Point
  size: Size
  origin: Point
  kind: "drag" | "width" | "height"
  moved: boolean
  capture: Element
  last: Point
  minimize: boolean
}

/** A browser-owned presentation of a normal quick chat; sidebar selection is deliberately unrelated. */
export function BrowserQuickChat({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const state = useBrowserQuickChat()
  const session = useSession(state.sessionId)
  const connection = useApp((s) => s.connection)
  const record = useApp((s) => (state.sessionId === null ? undefined : s.runStates[state.sessionId]))
  const focused = useWindowFocus()
  useReadVisibleSession(state.sessionId, active && state.expanded && focused)
  const root = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [container, setContainer] = useState<Size>({ width: 0, height: 0 })
  const [offset, setOffset] = useState<Point | null>(null)
  const [liveSize, setLiveSize] = useState<Size | null>(null)
  const [moving, setMoving] = useState(false)
  const [animate, setAnimate] = useState(false)
  const [iconReady, setIconReady] = useState(!state.expanded)
  const [minimizedCorner, setMinimizedCorner] = useState<ReturnType<typeof nearestQuickChatCorner>>({
    side: "right",
    edge: "bottom"
  })
  const wasExpanded = useRef(state.expanded)
  const resetting = useRef(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const frame = useRef<number | null>(null)
  const pendingVisual = useRef<{ offset?: Point; size?: Size } | null>(null)
  const suppressClick = useRef(false)
  const size = quickChatSize(liveSize ?? state.size, container)
  const closing = !state.expanded && !iconReady
  const panelVisible = state.expanded || closing
  const displaySize = state.expanded ? size : { width: 40, height: 40 }
  const side = panelVisible ? state.side : minimizedCorner.side
  const edge = panelVisible ? state.edge : minimizedCorner.edge
  const dock = quickChatAnchor(side, { width: 0, height: 0 }, container, edge)
  const transform = offset
    ? `translate3d(${offset.x}px, ${offset.y}px, 0)`
    : `translate3d(${side === "right" ? `calc(${dock.x}px - 100%)` : `${dock.x}px`}, ${edge === "bottom" ? `calc(${dock.y}px - 100%)` : `${dock.y}px`}, 0)`
  const opened = useRef(false)
  const retryReplace = useRef(false)

  const prepare = async (replace = false) => {
    if (busyRef.current) return
    busyRef.current = true
    retryReplace.current = replace
    setBusy(true)
    setError(null)
    try {
      await prepareBrowserChat(replace)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  useLayoutEffect(() => {
    if (!active) return
    resetting.current = true
    wasExpanded.current = false
    setAnimate(false)
    setMinimizedCorner({ side: "right", edge: "bottom" })
    setIconReady(true)
    setOffset(null)
    setLiveSize(null)
    useBrowserQuickChat.setState({ expanded: false })
  }, [active])
  useLayoutEffect(() => {
    if (!active || !state.revealSessionId) return
    if (state.revealSessionId !== state.sessionId) {
      useBrowserQuickChat.setState({ revealSessionId: null })
      return
    }
    resetting.current = false
    wasExpanded.current = true
    setIconReady(false)
    useBrowserQuickChat.setState({ expanded: true, revealSessionId: null })
  }, [active, state.revealSessionId, state.sessionId])
  useEffect(() => {
    if (!active) return
    let next: number | null = null
    const first = requestAnimationFrame(() => {
      next = requestAnimationFrame(() => setAnimate(true))
    })
    return () => {
      cancelAnimationFrame(first)
      if (next !== null) cancelAnimationFrame(next)
    }
  }, [active])
  useEffect(() => {
    if (resetting.current) {
      if (!state.expanded) resetting.current = false
      wasExpanded.current = false
      setIconReady(true)
      return
    }
    const previous = wasExpanded.current
    wasExpanded.current = state.expanded
    if (state.expanded) {
      setIconReady(false)
      return
    }
    if (!previous) {
      setIconReady(true)
      return
    }
    setMinimizedCorner({ side: state.side, edge: state.edge })
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const timer = window.setTimeout(() => setIconReady(true), reduced ? 0 : 260)
    return () => window.clearTimeout(timer)
  }, [state.expanded])
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const update = () =>
      setContainer({
        width: element.clientWidth,
        height: element.clientHeight
      })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [active])
  useLayoutEffect(() => {
    const element = panel.current
    if (!element || !state.expanded) return
    let composer: Element | null = null
    const update = () => {
      const next = element.querySelector('[data-tour="chat-input"]')
      if (composer !== next) {
        if (composer) observer.unobserve(composer)
        composer = next
        if (composer) observer.observe(composer)
      }
      if (!composer) return
      const header = element.querySelector("header")!
      // Leave gaps above and below the menu, including its surface padding.
      const available = composer.getBoundingClientRect().top - header.getBoundingClientRect().bottom - 24
      element.style.setProperty("--browser-chat-menu-height", `${Math.max(0, available)}px`)
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => observer.disconnect()
  }, [state.expanded, session?.id, session?.restoring, busy])
  useEffect(() => {
    useBrowserQuickChat.setState({ visible: active && state.expanded })
    return () => {
      useBrowserQuickChat.setState({ visible: false })
    }
  }, [active, state.expanded])
  useEffect(() => {
    if (!active || !state.expanded) return
    if (opened.current && state.sessionId !== null && client.state.sessions[state.sessionId]?.attached) return
    opened.current = true
    void prepare()
  }, [active, state.expanded])
  useEffect(() => {
    if (!active || !state.expanded || busy || !session?.attached || session.restoring) return
    surface.current?.querySelector<HTMLElement>('[contenteditable="true"], textarea')?.focus({ preventScroll: true })
  }, [active, state.expanded, busy, session?.id, session?.attached, session?.restoring])
  useEffect(() => {
    const cancel = () => {
      const g = gesture.current
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
      pendingVisual.current = null
      gesture.current = null
      if (g?.capture.hasPointerCapture?.(g.pointer)) g.capture.releasePointerCapture(g.pointer)
      setOffset(null)
      setLiveSize(null)
      setMoving(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && gesture.current) {
        e.preventDefault()
        e.stopPropagation()
        cancel()
      }
    }
    window.addEventListener("keydown", key, true)
    window.addEventListener("blur", cancel)
    return () => {
      window.removeEventListener("keydown", key, true)
      window.removeEventListener("blur", cancel)
      cancel()
    }
  }, [])

  const point = (e: ReactPointerEvent): Point => {
    const element = root.current!
    const bounds = element.getBoundingClientRect()
    return {
      x: ((e.clientX - bounds.left) * element.clientWidth) / bounds.width,
      y: ((e.clientY - bounds.top) * element.clientHeight) / bounds.height
    }
  }
  const start = (e: ReactPointerEvent, kind: Gesture["kind"]) => {
    if (e.button !== 0 || e.ctrlKey || gesture.current || container.width === 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    suppressClick.current = false
    const surfaceBounds = surface.current!.getBoundingClientRect()
    const rootBounds = root.current!.getBoundingClientRect()
    const origin = {
      x: ((surfaceBounds.left - rootBounds.left) * root.current!.clientWidth) / rootBounds.width,
      y: ((surfaceBounds.top - rootBounds.top) * root.current!.clientHeight) / rootBounds.height
    }
    gesture.current = {
      pointer: e.pointerId,
      start: point(e),
      origin,
      size,
      kind,
      moved: false,
      capture: e.currentTarget,
      last: point(e),
      minimize: false
    }
  }
  const move = (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g || g.pointer !== e.pointerId) return
    const p = point(e)
    const delta = { x: p.x - g.start.x, y: p.y - g.start.y }
    if (!g.moved && Math.hypot(delta.x, delta.y) < 4) return
    const dx = p.x - g.last.x
    const dy = p.y - g.last.y
    if (Math.hypot(dx, dy) >= 8) {
      if (dx >= 0 && dy > 0 && dy >= dx) g.minimize = true
      else if (dx < 0 || dy < 0 || dx > 2 * Math.abs(dy)) g.minimize = false
      g.last = p
    }
    if (!g.moved) setMoving(true)
    g.moved = true
    suppressClick.current = true
    pendingVisual.current =
      g.kind === "drag"
        ? {
            offset: {
              x: Math.max(0, Math.min(container.width - displaySize.width, g.origin.x + delta.x)),
              y: Math.max(0, g.origin.y + delta.y)
            }
          }
        : {
            size: resizeQuickChat(
              g.size,
              {
                x: g.kind === "height" ? 0 : delta.x,
                y: g.kind === "width" ? 0 : delta.y
              },
              state.side,
              container,
              state.edge
            )
          }
    if (frame.current === null)
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        const next = pendingVisual.current
        pendingVisual.current = null
        if (!gesture.current || !next) return
        if (next.offset) setOffset(next.offset)
        if (next.size) setLiveSize(next.size)
      })
  }

  const finish = (e: ReactPointerEvent, cancel = false) => {
    const g = gesture.current
    if (!g || g.pointer !== e.pointerId) return
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    pendingVisual.current = null
    if (!cancel && g.moved) {
      if (g.kind === "drag") {
        const p = point(e)
        const next = {
          x: g.origin.x + p.x - g.start.x,
          y: g.origin.y + p.y - g.start.y
        }
        const corner = nearestQuickChatCorner(next, displaySize, container)
        const minimize =
          state.expanded &&
          g.minimize &&
          corner.side === "right" &&
          corner.edge === "bottom" &&
          p.y > g.start.y &&
          next.y + size.height - container.height >= size.width / 2
        if (state.expanded) {
          useBrowserQuickChat.setState({ ...corner, ...(minimize ? { expanded: false } : {}) })
        } else {
          setMinimizedCorner(corner)
        }
      } else {
        const p = point(e)
        useBrowserQuickChat.setState({
          size: resizeQuickChat(
            g.size,
            {
              x: g.kind === "height" ? 0 : p.x - g.start.x,
              y: g.kind === "width" ? 0 : p.y - g.start.y
            },
            state.side,
            container,
            state.edge
          )
        })
      }
    }
    gesture.current = null
    setOffset(null)
    setLiveSize(null)
    setMoving(false)
    if (g.capture.hasPointerCapture?.(g.pointer)) g.capture.releasePointerCapture(g.pointer)
  }
  const resizeHandle = (kind: "width" | "height") => (
    <div
      key={kind}
      role="separator"
      data-quick-chat-resize={kind}
      style={{ backgroundImage: "none", backgroundColor: "transparent" }}
      aria-label={t(kind === "width" ? "browser.quickChat.resizeWidth" : "browser.quickChat.resizeHeight")}
      aria-orientation={kind === "width" ? "vertical" : "horizontal"}
      aria-valuemin={kind === "width" ? Math.min(360, size.width) : Math.min(400, size.height)}
      aria-valuemax={kind === "width" ? container.width - 32 : container.height - 32}
      aria-valuenow={kind === "width" ? size.width : size.height}
      tabIndex={0}
      className={cn(
        "absolute z-40 touch-none focus-visible:outline-2 focus-visible:outline-ring",
        kind === "height"
          ? cn("inset-x-3 h-2 cursor-row-resize", state.edge === "top" ? "bottom-0" : "top-0")
          : cn("inset-y-3 w-2 cursor-col-resize", state.side === "left" ? "right-0" : "left-0")
      )}
      onPointerDown={(e) => start(e, kind)}
      onDoubleClick={() =>
        useBrowserQuickChat.setState({
          size: {
            ...state.size,
            ...(kind === "width" ? { width: quickChatDefault.width } : { height: quickChatDefault.height })
          }
        })
      }
      onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return
        e.preventDefault()
        e.stopPropagation()
        const width = kind === "width"
        const increment = width
          ? (e.key === "ArrowRight" ? 10 : e.key === "ArrowLeft" ? -10 : 0) * (state.side === "left" ? 1 : -1)
          : (e.key === "ArrowDown" ? 10 : e.key === "ArrowUp" ? -10 : 0) * (state.edge === "top" ? 1 : -1)
        const value =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? width
                ? container.width
                : container.height
              : (width ? size.width : size.height) + increment
        useBrowserQuickChat.setState({
          size: quickChatSize({ ...size, ...(width ? { width: value } : { height: value }) }, container)
        })
      }}
    />
  )
  return (
    <div
      ref={root}
      data-browser-quick-chat
      className="pointer-events-none absolute inset-x-0 top-11 bottom-0 z-30 overflow-hidden"
      hidden={!active}
    >
      <div
        ref={surface}
        data-browser-chat-session={state.sessionId ?? undefined}
        inert={closing}
        onPointerMove={move}
        onPointerUp={(e) => finish(e)}
        onPointerCancel={(e) => finish(e, true)}
        onLostPointerCapture={(e) => finish(e, true)}
        className={cn(
          "absolute bg-background text-foreground shadow-xl",
          (panelVisible || record?.state !== "running") && "overflow-hidden",
          closing ? "pointer-events-none" : "pointer-events-auto",
          !moving &&
            animate &&
            "motion-safe:transition-[transform,width,height,border-radius] motion-safe:duration-[260ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]",
          moving && "transition-none"
        )}
        style={{
          left: 0,
          top: 0,
          transform,
          borderRadius: state.expanded ? 24 : 20,
          transition: moving ? "none" : undefined,
          willChange: moving ? "transform" : undefined,
          width: displaySize.width,
          height: displaySize.height
        }}
        onClickCapture={(e) => {
          if (suppressClick.current && e.detail > 0) {
            e.preventDefault()
            e.stopPropagation()
            suppressClick.current = false
          }
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {state.expanded && (["width", "height"] as const).map(resizeHandle)}
        {(panelVisible || opened.current) && (
          <div
            ref={panel}
            data-quick-chat-panel
            aria-hidden={!state.expanded}
            inert={!state.expanded}
            className="absolute flex flex-col overflow-hidden rounded-3xl border border-border motion-safe:transition-opacity motion-safe:duration-100"
            style={{
              width: size.width,
              height: size.height,
              left: state.side === "left" ? 0 : undefined,
              right: state.side === "right" ? 0 : undefined,
              top: state.edge === "top" ? 0 : undefined,
              bottom: state.edge === "bottom" ? 0 : undefined,
              opacity: state.expanded ? 1 : 0,
              visibility: panelVisible ? "visible" : "hidden"
            }}
          >
            <header
              className="flex h-10 shrink-0 cursor-grab touch-none items-center gap-2 border-b border-border px-3 select-none active:cursor-grabbing"
              onPointerDown={(e) => {
                if (e.target instanceof Element && e.target.closest("button, a, input, textarea, select")) return
                start(e, "drag")
              }}
              onDoubleClick={(e) => {
                if (e.target instanceof Element && e.target.closest("button, a, input, textarea, select")) return
                useBrowserQuickChat.setState({ side: "right", edge: "bottom", size: quickChatDefault })
              }}
            >
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("browser.quickChat.minimize")}
                title={t("browser.quickChat.minimize")}
                onClick={() => useBrowserQuickChat.setState({ expanded: false })}
              >
                <ChevronDown className="size-4" />
              </Button>
              <div className="min-w-0 flex-1" />
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                aria-label={t("browser.quickChat.newChat")}
                title={t("browser.quickChat.newChat")}
                onClick={() => void prepare(true)}
              >
                <Plus />
              </Button>
              <div data-quick-chat-drag className="grid size-7 shrink-0 place-items-center text-muted-foreground">
                <GripVertical className="size-4" />
              </div>
            </header>
            {error && (
              <div role="alert" className="flex shrink-0 items-center gap-2 px-3 py-2 text-sm text-destructive">
                <span className="min-w-0 flex-1 break-words">{error}</span>
                <Button variant="outline" size="sm" onClick={() => void prepare(retryReplace.current)}>
                  {t("browser.quickChat.retry")}
                </Button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-hidden rounded-b-3xl" aria-busy={busy}>
              {session ? (
                <BrowserConversation session={session} disabled={busy || error !== null || connection !== "ready"} />
              ) : busy ? (
                <div className="grid h-full place-items-center">
                  <Spinner />
                </div>
              ) : null}
            </div>
          </div>
        )}
        <Button
          className="absolute size-10 touch-none rounded-full border-0 motion-safe:transition-opacity motion-safe:duration-100"
          style={{
            left: (panelVisible ? state.side : minimizedCorner.side) === "left" ? 0 : undefined,
            right: (panelVisible ? state.side : minimizedCorner.side) === "right" ? 0 : undefined,
            top: (panelVisible ? state.edge : minimizedCorner.edge) === "top" ? 0 : undefined,
            bottom: (panelVisible ? state.edge : minimizedCorner.edge) === "bottom" ? 0 : undefined,
            opacity: state.expanded ? 0 : 1,
            transitionDelay: closing ? "130ms" : "0ms"
          }}
          aria-hidden={state.expanded || closing}
          disabled={state.expanded || closing}
          size="icon"
          variant="ghost"
          aria-label={t("browser.quickChat.open")}
          onPointerDown={(e) => start(e, "drag")}
          onClick={() => useBrowserQuickChat.setState({ ...minimizedCorner, expanded: true })}
        >
          <MessageCircle className="size-5" />
          {record?.state === "running" ? (
            <span
              aria-label={t("browser.quickChat.running")}
              className="pointer-events-none absolute inset-e-[5px] top-[5px] flex size-2.5 items-center justify-center"
            >
              <SessionStateDot state="running" className="motion-reduce:[&>span:first-child]:hidden" />
            </span>
          ) : record && record.state !== "idle" ? (
            <span
              aria-label={t(`browser.quickChat.${record.state}`)}
              className={cn(
                "absolute inset-e-[5px] top-[5px] size-2.5 rounded-full border border-background",
                RUN_STATE_COLOR[record.state]
              )}
            />
          ) : null}
        </Button>
      </div>
    </div>
  )
}
