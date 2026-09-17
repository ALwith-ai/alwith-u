import { ArrowDownIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { Session } from "@alwith/api"
import { AssistantTurn } from "./codex/assistant-turn"
import {
  type NavigationRailItem,
  ThreadUserMessageNavigationRail,
  toNavigationRailItems
} from "./codex/navigation-rail"
import { UserMessage } from "./codex/user-message"
import {
  VirtualizedTurnList,
  type VirtualizedTurnListApi,
  type VirtualizedTurnListEntry
} from "@alwith/module-chat/virtualized-turn-list"
import { clearThread, publishThread } from "./lib/thread-registry"
import { groupTurns, type Turn } from "./turns"

/** Scrolling down into this band while a turn streams re-engages following. */
const CODEX_FOLLOW_ENGAGE_DISTANCE_PX = 160
/** The anchored turn sits this far below the viewport top. */
const CODEX_ANCHOR_TOP_OFFSET_PX = 64

/**
 * Codex's turn anchoring: after a prompt the new turn is scrolled to the viewport top and
 * whatever height is missing below it is provided by a spacer, which only resets on the
 * next prompt.
 */
export function codexAnchorPlan(input: {
  turnTopPx: number
  scrollHeightPx: number
  viewportHeightPx: number
  spacerPx: number
}): { scrollTopPx: number; spacerPx: number } {
  const target = Math.max(0, input.turnTopPx - CODEX_ANCHOR_TOP_OFFSET_PX)
  const maxScroll = Math.max(0, input.scrollHeightPx - input.viewportHeightPx)
  const overshoot = target - maxScroll
  return { scrollTopPx: target, spacerPx: overshoot > 0 ? input.spacerPx + overshoot : input.spacerPx }
}

function useStableTurns(session: Session): Turn[] {
  const previous = useRef<Turn[]>([])
  const turns = useMemo(() => groupTurns(session, previous.current), [session])
  previous.current = turns
  return turns
}

export function ThreadView({ session }: { session: Session }) {
  const { t } = useTranslation()
  const turns = useStableTurns(session)
  const running = session.state !== "idle"
  const entries = useMemo<VirtualizedTurnListEntry[]>(() => turns.map(turn => ({ turnKey: turn.key })), [turns])
  const railItems = useMemo(() => toNavigationRailItems(turns, session.turnUsage), [turns, session.turnUsage])
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null)
  const threadRef = useRef<VirtualizedTurnListApi>(null)
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const streamingRef = useRef(false)
  streamingRef.current = running
  const previousScrollTopRef = useRef(0)
  // The scroll event of a programmatic pin arrives later, when the content has grown again;
  // its distance would read as a user scrolling up. Remember the value to recognise the echo.
  const programmaticScrollTopRef = useRef(Number.NaN)
  const pinFrameRef = useRef<number | null>(null)
  const [spacerHeightPx, setSpacerHeightPx] = useState(0)
  const spacerHeightRef = useRef(0)
  spacerHeightRef.current = spacerHeightPx

  const scrollToBottom = useCallback(() => {
    if (scrollRoot === null) return
    scrollRoot.scrollTo({ behavior: "instant", top: scrollRoot.scrollHeight })
    programmaticScrollTopRef.current = scrollRoot.scrollTop
    atBottomRef.current = true
    setAtBottom(true)
  }, [scrollRoot])

  // Jumping to a message releases following; the virtual window mounts the turn first.
  const stopFollowing = useCallback(() => {
    atBottomRef.current = false
    setAtBottom(false)
  }, [])
  // Search uses the same release-before-reveal lifecycle as message navigation.
  useEffect(() => {
    publishThread({ sessionId: session.id, turns, api: threadRef.current, beforeReveal: stopFollowing })
  }, [session.id, turns, stopFollowing])
  useEffect(() => () => clearThread(session.id), [session.id])
  const ensureTurnMounted = useCallback(async (item: NavigationRailItem) => {
    const thread = threadRef.current
    if (thread === null) throw new Error("Codex virtual thread is not mounted")
    await thread.scrollToKey(
      item.turnKey,
      turnElement => turnElement.querySelector<HTMLElement>(`[data-content-search-unit-key="${CSS.escape(item.id)}"]`),
      { align: "top" }
    )
  }, [])

  // One pin per frame: turn batches, the content observer and the spacer transition would
  // otherwise each force a synchronous layout inside the same chunk.
  const schedulePin = useCallback(() => {
    if (scrollRoot === null || pinFrameRef.current !== null) return
    pinFrameRef.current = requestAnimationFrame(() => {
      pinFrameRef.current = null
      if (!atBottomRef.current) return
      scrollRoot.scrollTop = scrollRoot.scrollHeight
      programmaticScrollTopRef.current = scrollRoot.scrollTop
    })
  }, [scrollRoot])
  useEffect(
    () => () => {
      if (pinFrameRef.current !== null) cancelAnimationFrame(pinFrameRef.current)
      pinFrameRef.current = null
    },
    []
  )

  // Anchor the last turn at the viewport top, growing the spacer when the content is too
  // short to scroll there. The virtual window has to mount the turn first (scrollToKey).
  const anchorLastTurn = useCallback(() => {
    if (scrollRoot === null) return
    const lastTurnKey = turns.at(-1)?.key
    if (lastTurnKey === undefined) return
    const measureAndAnchor = () =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const lastTurn = scrollRoot.querySelector<HTMLElement>(`[data-codex-turn="${CSS.escape(lastTurnKey)}"]`)
          if (lastTurn === null) return
          const turnTopPx =
            scrollRoot.scrollTop + lastTurn.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top
          const plan = codexAnchorPlan({
            turnTopPx,
            scrollHeightPx: scrollRoot.scrollHeight,
            viewportHeightPx: scrollRoot.clientHeight,
            spacerPx: spacerHeightRef.current
          })
          setSpacerHeightPx(plan.spacerPx)
          requestAnimationFrame(() => scrollRoot.scrollTo({ top: plan.scrollTopPx, behavior: "instant" }))
        })
      )
    const thread = threadRef.current
    if (thread !== null) {
      // scrollToKey throws synchronously while the layout is not ready yet; measure directly then.
      try {
        void thread.scrollToKey(lastTurnKey, undefined, { align: "top" }).then(measureAndAnchor)
        return
      } catch {
        // fall through
      }
    }
    measureAndAnchor()
  }, [scrollRoot, turns])

  useEffect(() => {
    if (scrollRoot === null) return
    const updateAtBottom = () => {
      const scrollTop = scrollRoot.scrollTop
      const distancePx = scrollRoot.scrollHeight - scrollRoot.clientHeight - scrollTop
      const previousScrollTop = previousScrollTopRef.current
      previousScrollTopRef.current = scrollTop
      if (scrollTop === programmaticScrollTopRef.current) {
        programmaticScrollTopRef.current = Number.NaN
        return
      }
      const scrolledUp = scrollTop < previousScrollTop
      // Idle: the plain 24px rule. Streaming: once following, only scrolling up releases;
      // when released, scrolling down into the engage band re-attaches and pins.
      const nextAtBottom = streamingRef.current
        ? atBottomRef.current
          ? !scrolledUp || distancePx <= 24
          : !scrolledUp && distancePx <= CODEX_FOLLOW_ENGAGE_DISTANCE_PX
        : distancePx <= 24
      if (atBottomRef.current === nextAtBottom) return
      atBottomRef.current = nextAtBottom
      setAtBottom(nextAtBottom)
      if (nextAtBottom) schedulePin()
    }
    // Toggling a disclosure (work section, command output, edited files) releases following
    // before React grows the content, so the toggle stays under the pointer.
    const releaseOnDisclosureToggle = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest("button[aria-expanded]") === null) return
      atBottomRef.current = false
      setAtBottom(false)
    }
    scrollRoot.addEventListener("scroll", updateAtBottom, { passive: true })
    scrollRoot.addEventListener("click", releaseOnDisclosureToggle, { capture: true })
    updateAtBottom()
    return () => {
      scrollRoot.removeEventListener("scroll", updateAtBottom)
      scrollRoot.removeEventListener("click", releaseOnDisclosureToggle, { capture: true })
    }
  }, [schedulePin, scrollRoot])

  // While following, any content growth (measured turn heights, late images, the spacer
  // transition) pins again. Declared after the scroll sync so a restored position has
  // already cleared the ref before the observer's first callback.
  useEffect(() => {
    if (scrollRoot === null) return
    const content = scrollRoot.firstElementChild
    if (!(content instanceof HTMLElement)) throw new Error("Codex scroll content element is missing")
    const observer = new ResizeObserver(() => {
      if (!atBottomRef.current) return
      schedulePin()
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [schedulePin, scrollRoot])

  useEffect(() => {
    if (session.items.length === 0) return
    if (atBottomRef.current) schedulePin()
  }, [schedulePin, session.items])

  // Mounted per session (ChatView is keyed), so the spacer and the turn memory start empty;
  // opening history lands at the bottom (the virtual list restores a remembered position itself).
  const previousLastRef = useRef<{ key: string; hasUser: boolean } | null>(null)

  useEffect(() => {
    if (scrollRoot === null) return
    const last = turns.at(-1)
    const previous = previousLastRef.current
    previousLastRef.current = last === undefined ? null : { key: last.key, hasUser: last.user !== null }
    if (last === undefined || previous === null) return
    if (last.user !== null && !last.replayed && last.key !== previous.key) {
      spacerHeightRef.current = 0
      setSpacerHeightPx(0)
      anchorLastTurn()
    }
  }, [anchorLastTurn, scrollRoot, turns])

  const renderTurn = (entry: VirtualizedTurnListEntry, index: number) => {
    const turn = turns[index]
    if (turn === undefined || turn.key !== entry.turnKey) throw new Error(`Turn is missing at index ${index}`)
    const isLast = index === turns.length - 1
    const active = running && isLast
    const hasAssistant = turn.work.length > 0 || turn.final.length > 0 || active
    return (
      // The top inset lives inside the first turn: the virtual layout assumes its container
      // starts at scrollTop 0.
      <div
        data-virtualized-turn-content
        data-codex-turn={turn.key}
        className={index === 0 ? "flex flex-col gap-4 pt-4" : "flex flex-col gap-4"}>
        {turn.user !== null && <UserMessage item={turn.user} />}
        {hasAssistant && (
          <AssistantTurn
            turn={turn}
            terminals={session.terminals}
            active={active}
            isLast={isLast}
            error={session.error}
            interrupted={!active && isLast && session.lastStopReason === "cancelled"}
          />
        )}
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-stream-style="codexUI">
      <div
        ref={setScrollRoot}
        data-chat-scroll
        className="min-h-0 flex-1 scrollbar-thin overflow-y-auto overscroll-contain"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: 滚动容器需可聚焦才能用键盘滚动
        tabIndex={0}
        role="log"
        aria-label={t("chat.thread")}>
        <div className="min-h-full w-full px-6">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
            <VirtualizedTurnList
              ref={threadRef}
              entries={entries}
              renderTurn={renderTurn}
              scrollElement={scrollRoot}
              sessionKey={session.id}
            />
            <div
              aria-hidden="true"
              className="shrink-0"
              style={{ height: spacerHeightPx, transition: "height 0.5s cubic-bezier(0.25, 1, 0.5, 1)" }}
            />
            <div aria-hidden="true" className="h-6 shrink-0" />
          </div>
        </div>
      </div>
      <ThreadUserMessageNavigationRail
        items={railItems}
        scrollRoot={scrollRoot}
        beforeReveal={stopFollowing}
        ensureItemMounted={ensureTurnMounted}
        targetTopMarginPx={10}
      />
      <button
        type="button"
        className={atBottom ? "codex-scroll-to-bottom codex-scroll-to-bottom-hidden" : "codex-scroll-to-bottom"}
        tabIndex={atBottom ? -1 : undefined}
        onClick={scrollToBottom}
        aria-label={t("chat.scrollToBottom")}>
        {running ? (
          <span className="codex-scroll-to-bottom-dots" aria-hidden="true">
            <span className="codex-wave-dot" />
            <span className="codex-wave-dot" />
            <span className="codex-wave-dot" />
          </span>
        ) : (
          <ArrowDownIcon />
        )}
      </button>
    </div>
  )
}
