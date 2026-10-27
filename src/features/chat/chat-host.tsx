import {
  type ConversationHost,
  ConversationProvider,
  type ReportedError,
  type TimelineSlots
} from "@alwith/module-chat/conversation"
import type { NavigationRailAudio, TimelineViewportProps } from "@alwith/module-chat/session-timeline"
import { codexTurnId } from "@nyssance/codex-acp-v2/client"
import { invoke } from "@tauri-apps/api/core"
import { type ReactNode, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useStore } from "zustand"

import { commands } from "@/bindings"
import { Pane } from "@/components/alwith-ui/pane"
import { CodexFileIcon } from "@/components/icons/codex/file-icon"
import { useTheme } from "@/components/theme-provider"
import { computerActionKey, privateComputerAction } from "@/features/computer/action-label"
import { client } from "@/lib/client"

import { ForkOriginDivider, ForkTurnButton } from "./chat-branches"
import { useChatActivityHost } from "./codex/activity-host"
import {
  installTimelineUserMessageNavigationAudioUnlock,
  playTimelineUserMessageNavigationSequence,
  preloadTimelineUserMessageNavigationInstrument
} from "./codex/navigation-audio"
import { navigationSoundStore } from "./codex/navigation-sound-store"

function reportError(error: unknown) {
  const description = (error as ReportedError | null)?.description
  const message = error instanceof Error ? error.message : String(error)
  if (description) toast.error(message, { description })
  else toast.error(message)
}

/** U's host for the package conversation: activity host, theme, tool labels, files and errors. */
export function useChatHost(): ConversationHost {
  const activity = useChatActivityHost()
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  return useMemo(
    () => ({
      ...activity,
      theme: resolvedTheme,
      // Computer-use tools are private actions; show what they did, not the tool name.
      toolBlock: (block) => {
        const action = privateComputerAction(block.name) ?? privateComputerAction(block.title)
        return action ? { ...block, kind: "other" as const, title: t(computerActionKey(action)) } : block
      },
      saveFile: async (name, data) => {
        await invoke<boolean>("chat_save_file", { name, data })
      },
      FileIcon: CodexFileIcon,
      reportError,
      writeTextAttachment: (name, text) => commands.chatWriteTextAttachment({ name, text })
    }),
    [activity, resolvedTheme, t]
  )
}

/** Package conversation parts outside a conversation view (the draft surface, global requests). */
export function ChatHostProvider({ children }: { children: ReactNode }) {
  const host = useChatHost()
  return (
    <ConversationProvider host={host} client={client}>
      {children}
    </ConversationProvider>
  )
}

function PaneViewport({ viewportRef, viewportProps, children }: TimelineViewportProps) {
  return (
    <Pane
      nativeScroll
      viewportRef={viewportRef}
      viewportClassName="me-[var(--app-scrollbar-edge-gap)] overflow-x-hidden overscroll-none"
      viewportProps={viewportProps}
    >
      {children}
    </Pane>
  )
}

function useNavigationAudio(): NavigationRailAudio {
  const instrument = useStore(navigationSoundStore, (state) => state.instrument)
  const soundMode = useStore(navigationSoundStore, (state) => state.soundMode)
  return useMemo(
    () => ({
      // With sounds off, never create an audio context, not even on a user gesture.
      installUnlock: soundMode === "none" ? () => () => {} : installTimelineUserMessageNavigationAudioUnlock,
      preload: () => {
        if (soundMode !== "none") preloadTimelineUserMessageNavigationInstrument(instrument)
      },
      playSequence: (from, to, tokens) =>
        playTimelineUserMessageNavigationSequence(from, to, tokens, instrument, soundMode)
    }),
    [instrument, soundMode]
  )
}

/** U's timeline slots: fork lineage and actions, the Pane scroller and navigation sounds. */
export function useTimelineSlots(): TimelineSlots {
  const audio = useNavigationAudio()
  return useMemo(
    () => ({
      leading: <ForkOriginDivider />,
      afterTurn: (turn) => <ForkOriginDivider turn={turn} />,
      answerActions: (turn) => <ForkTurnButton turnId={codexTurnId(turn.final.at(-1)?._meta)} />,
      navigation: { audio },
      Viewport: PaneViewport
    }),
    [audio]
  )
}
