import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { textOf } from "@alwith/api"
import type { ThreadUserMessageNavigationItem as NavigationRailItem } from "@alwith/module-chat/navigation-rail"
import {
  type NavigationRailAudio,
  ThreadUserMessageNavigationRail as SharedRail
} from "@alwith/module-chat/navigation-rail"
import { type ComponentProps, useMemo } from "react"
import { useStore } from "zustand"
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
 * paragraph Codex answered with. Token counts come from the turn's idle frame; turns
 * replayed from history carry none and count as 0/0, as Desktop's adapter does.
 */
export function toNavigationRailItems(turns: Turn[], turnUsage: Record<string, acp.Usage> = {}): NavigationRailItem[] {
  const items: NavigationRailItem[] = []
  for (const turn of turns) {
    if (turn.user === null) continue
    let response = ""
    for (const message of turn.final) {
      const text = textOf(message.content).trim()
      if (text.length === 0) continue
      response = text.split(/\n\s*\n/)[0]
      break
    }
    const usage = turnUsage[turn.user.id]
    items.push({
      id: turn.user.id,
      turnKey: turn.key,
      label: messageText(turn.user),
      response,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0
    })
  }
  return items
}

export function ThreadUserMessageNavigationRail(props: Omit<ComponentProps<typeof SharedRail>, "audio">) {
  const navigationInstrument = useStore(navigationSoundStore, state => state.instrument)
  const navigationSoundMode = useStore(navigationSoundStore, state => state.soundMode)
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
  return <SharedRail {...props} audio={audio} />
}
