import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { textOf } from "@alwith/api"
import { CodexMarkdownRenderer, type MarkdownHost } from "@alwith/module-chat/markdown"
import type { ThreadUserMessageNavigationItem as NavigationRailItem } from "@alwith/module-chat/navigation-rail"
import {
  type NavigationRailAudio,
  ThreadUserMessageNavigationRail as SharedRail
} from "@alwith/module-chat/navigation-rail"
import { type ComponentProps, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"

import type { HistoryNavigationState } from "@/agent/history-navigation"
import { nativeTurnId } from "@/agent/history-navigation"
import { useTheme } from "@/components/theme-provider"

import { messageText, type Turn } from "../turns"
import {
  installThreadUserMessageNavigationAudioUnlock,
  playThreadUserMessageNavigationSequence,
  preloadThreadUserMessageNavigationInstrument
} from "./navigation-audio"
import { navigationSoundStore } from "./navigation-sound-store"

export type { ThreadUserMessageNavigationItem as NavigationRailItem } from "@alwith/module-chat/navigation-rail"

/**
 * One entry per turn that starts with a user message; the preview shows the first
 * final answer. Token counts come from the turn's idle frame; turns
 * replayed from history carry none and count as 0/0, as Desktop's adapter does.
 */
export function toNavigationRailItems(
  turns: Turn[],
  turnUsage: Record<string, acp.Usage> = {},
  navigation?: HistoryNavigationState
): NavigationRailItem[] {
  const items: NavigationRailItem[] = []
  for (const turn of turns) {
    if (turn.user === null) continue
    let response = ""
    for (const message of turn.final) {
      const text = textOf(message.content).trim()
      if (text.length === 0) continue
      response = text
    }
    const usage = turnUsage[turn.user.id]
    const nativeId = turn.items.map(nativeTurnId).find((id) => id !== null)
    items.push({
      id: turn.user.id,
      turnKey: turn.key,
      label: messageText(turn.user),
      response,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      ...(nativeId === undefined ? {} : { nativeTurnId: nativeId })
    })
  }
  if (!navigation?.complete) return items
  const byTurn = new Map<string, NavigationRailItem[]>()
  for (const item of items) {
    if (item.nativeTurnId === undefined) continue
    const group = byTurn.get(item.nativeTurnId) ?? []
    group.push(item)
    byTurn.set(item.nativeTurnId, group)
  }
  const indexed = new Set(navigation.turns.map((turn) => turn.turnId))
  const loaded = new Set(navigation.loadedTurnIds)
  return [
    ...navigation.turns.flatMap((turn) => {
      const current = byTurn.get(turn.turnId)
      if (current) return current
      if (loaded.has(turn.turnId)) return []
      const preview = navigation.previews[turn.turnId]
      return (preview?.messages.length ? preview.messages : [{ id: "", label: "", response: "" }]).map(
        (message, index) => ({
          id: `history:${turn.turnId}:${index === 0 ? "0" : message.id}`,
          messageId: message.id || undefined,
          turnKey: `history:${turn.turnId}`,
          nativeTurnId: turn.turnId,
          isLoaded: false,
          previewState: preview?.state ?? "loading",
          label: message.label,
          response: message.response,
          inputTokens: 0,
          outputTokens: 0
        })
      )
    }),
    ...items.filter((item) => item.nativeTurnId === undefined || !indexed.has(item.nativeTurnId))
  ]
}

function NavigationPreview({ item }: { item: NavigationRailItem }) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const host = useMemo<MarkdownHost>(
    () => ({ theme: resolvedTheme, copyLabel: t("actions.copy"), openLink: () => {}, preview: true }),
    [resolvedTheme, t]
  )
  if (item.previewState === "loading")
    return (
      <div role="status" className="animate-pulse space-y-2 py-1" aria-label={t("chat.navigationLoading")}>
        <div className="h-3 w-3/5 rounded bg-muted" />
        <div className="h-3 rounded bg-muted" />
        <div className="h-3 w-4/5 rounded bg-muted" />
      </div>
    )
  return (
    <>
      <div className="min-w-0 truncate font-medium">
        {item.previewState === "unavailable"
          ? t("chat.navigationUnavailable")
          : item.label || t("chat.navigationEmpty")}
      </div>
      {item.response && (
        <div
          className="pointer-events-none mt-1 line-clamp-3 text-muted-foreground [&_img]:hidden [&_pre]:max-h-20 [&_table]:table-fixed"
          data-navigation-response
        >
          <CodexMarkdownRenderer text={item.response} host={host} />
        </div>
      )}
    </>
  )
}

export function ThreadUserMessageNavigationRail(props: Omit<ComponentProps<typeof SharedRail>, "audio">) {
  const navigationInstrument = useStore(navigationSoundStore, (state) => state.instrument)
  const navigationSoundMode = useStore(navigationSoundStore, (state) => state.soundMode)
  const audio = useMemo<NavigationRailAudio>(
    () => ({
      installUnlock: installThreadUserMessageNavigationAudioUnlock,
      preload: () => {
        if (navigationSoundMode !== "none") preloadThreadUserMessageNavigationInstrument(navigationInstrument)
      },
      playSequence: (from, to, tokens) =>
        playThreadUserMessageNavigationSequence(from, to, tokens, navigationInstrument, navigationSoundMode)
    }),
    [navigationInstrument, navigationSoundMode]
  )
  return <SharedRail {...props} audio={audio} renderPreview={(item) => <NavigationPreview item={item} />} />
}
