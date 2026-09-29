import { ForkOriginDivider } from "./chat-branches"
import { ArrowDownIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
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
import { useThreadScroll } from "./lib/use-thread-scroll"
import { groupTurns, type Turn } from "./turns"

/** The anchored turn sits this far below the viewport top. */
const CODEX_ANCHOR_TOP_OFFSET_PX = 64

/**
 * Codex's turn anchoring: after a prompt the new turn is scrolled to the viewport top and
 * whatever height is missing below it is provided by a spacer. Streaming content consumes
 * that space, and the remainder is cleared when the turn finishes.
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
  const lastTurnKey = turns.at(-1)?.key
  const running = session.state !== "idle"
  const entries = useMemo<VirtualizedTurnListEntry[]>(() => turns.map(turn => ({ turnKey: turn.key })), [turns])
  const railItems = useMemo(() => toNavigationRailItems(turns, session.turnUsage), [turns, session.turnUsage])
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null)
  const threadRef = useRef<VirtualizedTurnListApi>(null)
  const [spacerHeightPx, setSpacerHeightPx] = useState(0)
  const spacerHeightRef = useRef(0)
  const anchorSpaceRef = useRef<{ element: HTMLElement; heightPx: number; keepTop: boolean } | null>(null)
  spacerHeightRef.current = spacerHeightPx
  const releaseTurnAnchor = useCallback(() => {
    if (anchorSpaceRef.current !== null) anchorSpaceRef.current.keepTop = false
  }, [])

  const { isFollowing, scrollToBottom, stopFollowing, schedulePin, contentResized, beginLocate, cancelLocation } =
    useThreadScroll(scrollRoot, running, releaseTurnAnchor)
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

  // Anchor the last turn at the viewport top, growing the spacer when the content is too
  // short to scroll there. The virtual window has to mount the turn first (scrollToKey).
  const anchorLastTurn = useCallback(() => {
    if (scrollRoot === null) return
    const lastTurnKey = turns.at(-1)?.key
    if (lastTurnKey === undefined) return
    const location = beginLocate(true)
    const measureAndAnchor = () =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!location.isCurrent()) return
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
          anchorSpaceRef.current =
            plan.spacerPx > 0
              ? { element: lastTurn, heightPx: lastTurn.getBoundingClientRect().height + plan.spacerPx, keepTop: true }
              : null
          setSpacerHeightPx(plan.spacerPx)
          requestAnimationFrame(() => {
            if (!location.isCurrent()) return
            location.finish(plan.scrollTopPx)
          })
        })
      )
    const thread = threadRef.current
    if (thread === null) throw new Error("Codex virtual thread is not mounted")
    void thread.scrollToKey(lastTurnKey, undefined, { align: "top" }).then(() => {
      if (location.isCurrent()) measureAndAnchor()
    })
  }, [beginLocate, scrollRoot, turns])

  useEffect(() => {
    if (running) return
    cancelLocation()
    anchorSpaceRef.current = null
    spacerHeightRef.current = 0
    setSpacerHeightPx(0)
  }, [cancelLocation, running])

  // Observe the measured list and latest turn, excluding the spacer we resize.
  // Consume space before paint so neither the browser nor follow sees the
  // temporary extra height between an answer growing and its spacer shrinking.
  useEffect(() => {
    if (scrollRoot === null) return
    const content = scrollRoot.querySelector<HTMLElement>("[data-codex-thread]")
    if (content === null) throw new Error("Codex scroll content element is missing")
    const observer = new ResizeObserver(() => {
      const anchorSpace = anchorSpaceRef.current
      let anchorTop: number | null = null
      if (anchorSpace !== null) {
        const remainingPx = Math.max(0, anchorSpace.heightPx - anchorSpace.element.getBoundingClientRect().height)
        // While still anchored, replacing the loading indicator with the first
        // Markdown block can shrink the turn. Keep its top steady in both directions;
        // a user disclosure releases following, and must not recreate empty space.
        if (remainingPx !== spacerHeightRef.current && (remainingPx < spacerHeightRef.current || anchorSpace.keepTop)) {
          spacerHeightRef.current = remainingPx
          flushSync(() => setSpacerHeightPx(remainingPx))
          if (remainingPx === 0) anchorSpaceRef.current = null
        }
        if (remainingPx > 0 && anchorSpace.keepTop) {
          anchorTop =
            scrollRoot.scrollTop +
            anchorSpace.element.getBoundingClientRect().top -
            scrollRoot.getBoundingClientRect().top -
            CODEX_ANCHOR_TOP_OFFSET_PX
        }
      }
      contentResized(anchorTop)
    })
    observer.observe(content)
    observer.observe(scrollRoot)
    if (lastTurnKey !== undefined) {
      const lastTurn = scrollRoot.querySelector<HTMLElement>(`[data-codex-turn="${CSS.escape(lastTurnKey)}"]`)
      if (lastTurn === null) throw new Error("Latest Codex turn is not mounted")
      observer.observe(lastTurn)
    }
    return () => observer.disconnect()
  }, [contentResized, lastTurnKey, scrollRoot])

  useEffect(() => {
    if (session.items.length === 0) return
    schedulePin()
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
      anchorSpaceRef.current = null
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
        className={index === 0 ? "flex flex-col gap-1.5 pt-3" : "flex flex-col gap-1.5"}>
        {index === 0 && <ForkOriginDivider />}
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
        <ForkOriginDivider turn={turn} />
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-stream-style="codexUI">
      <div
        ref={setScrollRoot}
        data-chat-scroll
        className="min-h-0 flex-1 scrollbar-thin overflow-x-hidden overflow-y-auto overscroll-contain"
        style={{ overflowAnchor: "none" }}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The scroll container must be focusable to support keyboard scrolling.
        tabIndex={0}
        role="log"
        aria-label={t("chat.thread")}>
        <div className="min-h-full w-full px-5">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
            <VirtualizedTurnList
              ref={threadRef}
              entries={entries}
              renderTurn={renderTurn}
              scrollElement={scrollRoot}
              sessionKey={session.id}
            />
            <div aria-hidden="true" data-turn-anchor-spacer className="shrink-0" style={{ height: spacerHeightPx }} />
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
        className={isFollowing ? "codex-scroll-to-bottom codex-scroll-to-bottom-hidden" : "codex-scroll-to-bottom"}
        tabIndex={isFollowing ? -1 : undefined}
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
