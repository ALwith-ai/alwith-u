import type { Session } from "@alwith/api"
import {
  VirtualizedTurnList,
  type VirtualizedTurnListApi,
  type VirtualizedTurnListEntry
} from "@alwith/module-chat/virtualized-turn-list"
import { ArrowDownIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  codexExtensionCapabilities,
  codexMessageError,
  codexRetryNotice,
  codexTurnError
} from "@/agent/codex-extensions"
import { type HistoryTurnSummary, nativeTurnId } from "@/agent/history-navigation"
import { Pane } from "@/components/alwith-ui/pane"
import { Button } from "@/components/ui/button"
import { client, useApp } from "@/lib/client"

import { ForkOriginDivider } from "./chat-branches"
import { AssistantTurn } from "./codex/assistant-turn"
import {
  type NavigationRailItem,
  ThreadUserMessageNavigationRail,
  toNavigationRailItems
} from "./codex/navigation-rail"
import { formatTurnTime } from "./codex/turn-time"
import { UserMessage } from "./codex/user-message"
import { ChatDirectoryContext } from "./file-actions"
import { historyTimeline, type HistoryTimelineEntry } from "./history-timeline"
import { clearThread, publishThread } from "./lib/thread-registry"
import { capacityRetryDelay } from "./lib/turn-retry"
import { useThreadScroll } from "./lib/use-thread-scroll"
import { groupTurns, isHistoryInterrupted, isTurnInterrupted, type Turn } from "./turns"

function HistoryTurnPlaceholder({
  sessionId,
  turnId,
  root,
  error,
  connected
}: {
  sessionId: string
  turnId: string
  root: HTMLElement | null
  error?: string
  connected: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()
  const load = useCallback(() => {
    void client.loadHistoryTurn(sessionId, turnId).catch(() => {})
  }, [sessionId, turnId])
  useEffect(() => {
    if (!root || !ref.current || !connected || error) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          load()
        }
      },
      { root, rootMargin: "800px 0px" }
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [root, connected, error, load])
  return (
    <div
      ref={ref}
      className="flex min-h-80 flex-col justify-center gap-3 py-8"
      data-history-turn={turnId}
      data-markdown-pending
    >
      {error ? (
        <div className="flex flex-col items-center gap-2">
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={load} disabled={!connected}>
            {t("chat.navigationRetry")}
          </Button>
        </div>
      ) : (
        <div role="status" aria-label={t("chat.navigationLoading")} className="space-y-3">
          <div className="ml-auto h-5 w-1/3 rounded bg-muted" />
          <div className="h-3 w-4/5 rounded bg-muted" />
          <div className="h-3 w-3/5 rounded bg-muted" />
        </div>
      )}
    </div>
  )
}

function useStableTurns(session: Session, historyOrder?: HistoryTurnSummary[]): Turn[] {
  const previous = useRef<Turn[]>([])
  // Session status, unread state and model metadata change while a turn is
  // streaming without changing its item list. Grouping is O(items), so keep
  // the derived turn tree stable until the protocol actually upserts an item.
  const cache = useRef<{
    items: Session["items"]
    ended: Session["turnEndedAt"]
    usage: Session["turnUsage"]
    turns: Turn[]
    historyOrder?: HistoryTurnSummary[]
  } | null>(null)
  if (
    cache.current?.items !== session.items ||
    cache.current.ended !== session.turnEndedAt ||
    cache.current.usage !== session.turnUsage ||
    cache.current.historyOrder !== historyOrder
  ) {
    cache.current = {
      items: session.items,
      ended: session.turnEndedAt,
      usage: session.turnUsage,
      historyOrder,
      turns: groupTurns(session, previous.current, historyOrder)
    }
  }
  const turns = cache.current.turns
  previous.current = turns
  return turns
}

export function ThreadView({ session }: { session: Session }) {
  const { t } = useTranslation()
  const navigation = useApp((state) => state.historyNavigation?.[session.id])
  const turns = useStableTurns(session, navigation?.turns)
  const lastTurnKey = turns.at(-1)?.key
  const running = session.state !== "idle"
  const entries = useMemo(() => historyTimeline(turns, navigation), [turns, navigation])
  const railItems = useMemo(
    () => toNavigationRailItems(turns, session.turnUsage, navigation),
    [turns, session.turnUsage, navigation]
  )
  const turnsRef = useRef(turns)
  turnsRef.current = turns
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null)
  const history = useApp((state) => state.historyPages[session.id])
  const connected = useApp((state) => state.connection === "ready")
  const supportsRetry = useApp((state) => codexExtensionCapabilities(state.agent).sessionRetry)
  const hasHistory = history !== undefined
  useEffect(() => {
    if (connected && hasHistory && !session.restoring) void client.loadHistoryNavigation(session.id).catch(() => {})
  }, [connected, hasHistory, session.id, session.restoring])
  const [nearTop, setNearTop] = useState(false)
  const threadRef = useRef<VirtualizedTurnListApi>(null)
  const [revealing, setRevealing] = useState(false)
  const revealRevision = useRef(0)
  const { isFollowing, scrollToBottom, stopFollowing, schedulePin, contentResized } = useThreadScroll(
    scrollRoot,
    running
  )
  const loadOlder = useCallback(() => {
    stopFollowing()
    // The page state owns the retry message, including requests from the floating window.
    void client.loadOlderHistory(session.id).catch(() => {})
  }, [session.id, stopFollowing])
  useEffect(() => {
    if (scrollRoot === null) return
    const onScroll = () => {
      const near = scrollRoot.scrollTop < 600
      setNearTop(near)
      if (
        near &&
        !navigation?.complete &&
        connected &&
        !session.restoring &&
        !isFollowing &&
        history?.cursor &&
        !history.loading &&
        !history.error
      )
        loadOlder()
    }
    onScroll()
    scrollRoot.addEventListener("scroll", onScroll, { passive: true })
    return () => scrollRoot.removeEventListener("scroll", onScroll)
  }, [connected, history, isFollowing, loadOlder, scrollRoot, session.restoring, navigation?.complete])
  // Search uses the same release-before-reveal lifecycle as message navigation.
  useEffect(() => {
    publishThread({ sessionId: session.id, turns, api: threadRef.current, beforeReveal: stopFollowing })
  }, [session.id, turns, stopFollowing])
  useEffect(() => () => clearThread(session.id), [session.id])
  const ensureTurnMounted = useCallback(
    async (item: NavigationRailItem, isCurrent: () => boolean) => {
      const revision = ++revealRevision.current
      setRevealing(true)
      try {
        if (item.isLoaded === false && item.nativeTurnId !== undefined) {
          await client.loadHistoryTurn(session.id, item.nativeTurnId)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        }
        if (!isCurrent()) return null
        const target =
          turnsRef.current.find((turn) => turn.user?.id === (item.messageId ?? item.id)) ??
          turnsRef.current.find(
            (turn) =>
              turn.user !== null &&
              item.nativeTurnId !== undefined &&
              turn.items.some((value) => nativeTurnId(value) === item.nativeTurnId)
          )
        if (!target?.user) return null
        const userId = target.user.id
        const thread = threadRef.current
        if (thread === null) throw new Error("Codex virtual thread is not mounted")
        await thread.scrollToKey(
          target.key,
          (turnElement) =>
            turnElement.querySelector<HTMLElement>(`[data-content-search-unit-key="${CSS.escape(userId)}"]`),
          { align: "top" }
        )
        return document.querySelector<HTMLElement>(
          `[data-chat-scroll] [data-content-search-unit-key="${CSS.escape(userId)}"]`
        )
      } finally {
        if (revealRevision.current === revision) setRevealing(false)
      }
    },
    [session.id]
  )
  const previewItem = useCallback(
    async (item: NavigationRailItem) => {
      if (item.nativeTurnId !== undefined) await client.previewHistoryTurn(session.id, item.nativeTurnId)
    },
    [session.id]
  )

  // Follow measured content growth without adding artificial scroll range.
  useEffect(() => {
    if (scrollRoot === null) return
    const content = scrollRoot.querySelector<HTMLElement>("[data-codex-thread]")
    if (content === null) throw new Error("Codex scroll content element is missing")
    const observer = new ResizeObserver(() => {
      contentResized()
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

  // Mounted per session (ChatView is keyed), so the turn memory starts empty;
  // opening history lands at the bottom (the virtual list restores a remembered position itself).
  const previousLastRef = useRef<string | null>(null)

  useEffect(() => {
    if (scrollRoot === null) return
    const last = turns.at(-1)
    const previous = previousLastRef.current
    previousLastRef.current = last?.key ?? null
    if (last === undefined || previous === null) return
    if (last.user !== null && !last.replayed && last.key !== previous) scrollToBottom()
  }, [scrollToBottom, scrollRoot, turns])

  const renderTurn = (entry: VirtualizedTurnListEntry, index: number) => {
    const timelineEntry = entry as HistoryTimelineEntry
    const turn = timelineEntry.turn
    if (turn === undefined) {
      if (timelineEntry.nativeTurnId === undefined) throw new Error(`Turn is missing at index ${index}`)
      return (
        <HistoryTurnPlaceholder
          sessionId={session.id}
          turnId={timelineEntry.nativeTurnId}
          root={scrollRoot}
          error={navigation?.turnErrors[timelineEntry.nativeTurnId]}
          connected={connected && !isFollowing && !revealing}
        />
      )
    }
    const isLast = turn.key === lastTurnKey
    const active = running && isLast
    const failedItem = turn.errors.at(-1)
    const failure = failedItem === undefined ? null : codexMessageError(failedItem)
    const failedTurnId = failedItem === undefined ? null : nativeTurnId(failedItem)
    const canRetry =
      isLast &&
      !active &&
      connected &&
      supportsRetry &&
      session.attached &&
      !session.readOnly &&
      !session.restoring &&
      failedItem === session.items.at(-1) &&
      failure !== null &&
      codexTurnError(failure).category === "overloaded" &&
      failedTurnId !== null &&
      session.lastStopReason !== "end_turn" &&
      session.lastStopReason !== "cancelled"
    const hasAssistant =
      turn.work.length > 0 ||
      turn.final.length > 0 ||
      turn.errors.length > 0 ||
      active ||
      isHistoryInterrupted(turn) ||
      isTurnInterrupted(turn) ||
      (isLast && (session.error !== null || session.lastStopReason === "cancelled"))
    return (
      <div data-virtualized-turn-content data-codex-turn={turn.key} className="flex flex-col gap-1.5">
        <ChatDirectoryContext value={session.cwd}>
          {turn.user !== null && <UserMessage item={turn.user} messageTime={formatTurnTime(turn)} />}
          {hasAssistant && (
            <AssistantTurn
              turn={turn}
              terminals={session.terminals}
              active={active}
              isLast={isLast}
              error={session.error}
              retrying={active ? (codexRetryNotice(session._meta) ?? undefined) : undefined}
              retry={
                canRetry
                  ? {
                      turnId: failedTurnId,
                      delaySeconds: capacityRetryDelay(turns),
                      run: (trigger) => client.retrySession(session.id, failedTurnId, trigger)
                    }
                  : undefined
              }
              interrupted={isTurnInterrupted(turn) || (!active && isLast && session.lastStopReason === "cancelled")}
            />
          )}
        </ChatDirectoryContext>
        <ForkOriginDivider turn={turn} />
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-stream-style="codexUI">
      <Pane
        nativeScroll
        viewportRef={setScrollRoot}
        viewportClassName="overflow-x-hidden overscroll-none"
        viewportProps={{
          "data-chat-scroll": "",
          style: { overflowAnchor: "none" },
          tabIndex: 0,
          role: "log",
          "aria-label": t("chat.thread")
        }}
      >
        <div className="codex-thread-content flex min-h-full w-full flex-col px-5">
          <div data-thread-user-message-navigation-content className="mx-auto flex w-full max-w-3xl shrink-0 flex-col">
            <VirtualizedTurnList
              ref={threadRef}
              entries={entries}
              renderTurn={renderTurn}
              scrollElement={scrollRoot}
              sessionKey={session.id}
              preserveViewport={!isFollowing}
              leadingInsetPx={12}
              leadingContent={
                <div className="pt-3">
                  <ForkOriginDivider />
                </div>
              }
            />
            <div aria-hidden="true" className="h-6 shrink-0" />
          </div>
        </div>
      </Pane>
      <div aria-hidden="true" className="codex-thread-bottom-fade" />
      {navigation?.error && (
        <div className="absolute inset-x-0 top-2 z-10 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={!connected}
            title={navigation.error}
            onClick={() => {
              void client.loadHistoryNavigation(session.id).catch(() => {})
            }}
          >
            {t("chat.navigationRetry")}
          </Button>
        </div>
      )}
      {nearTop && history?.cursor && !navigation?.complete && (
        <div className="absolute inset-x-0 top-2 z-10 flex flex-col items-center gap-1" data-history-loader>
          <Button
            variant="outline"
            size="sm"
            disabled={!connected || session.restoring || history.loading}
            onClick={loadOlder}
          >
            {history.loading ? t("chat.loadingEarlier") : t("chat.loadEarlier")}
          </Button>
          {history.error && (
            <p role="alert" className="max-w-md rounded bg-background px-2 py-1 text-xs text-destructive">
              {history.error}
            </p>
          )}
        </div>
      )}
      <ThreadUserMessageNavigationRail
        key={session.id}
        items={railItems}
        scrollRoot={scrollRoot}
        beforeReveal={stopFollowing}
        ensureItemMounted={ensureTurnMounted}
        onPreviewItem={previewItem}
        onRevealError={(error) => toast.error(error instanceof Error ? error.message : String(error))}
        targetTopMarginPx={16}
      />
      <button
        type="button"
        className={isFollowing ? "codex-scroll-to-bottom codex-scroll-to-bottom-hidden" : "codex-scroll-to-bottom"}
        tabIndex={isFollowing ? -1 : undefined}
        onClick={scrollToBottom}
        aria-label={t("chat.scrollToBottom")}
      >
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
