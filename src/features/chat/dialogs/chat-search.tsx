import { ChatSearch as SharedChatSearch } from "@alwith/module-chat/search"
import { revealTimelineTurn, timelineRegistry } from "@alwith/module-chat/timeline-registry"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { type RefObject, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"

import { events } from "@/bindings"

import { findCodexSearchSourceMatches } from "../lib/codex-search-source"
import "./chat-search.css"
import { routeFind } from "@/features/workspace/editor-shortcuts"
import { client } from "@/lib/client"

const OPEN_SEARCH = "chat:find"

export function openChatSearch(sessionId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH, { detail: sessionId }))
}

export function ChatSearch({ rootRef, sessionId }: { rootRef: RefObject<HTMLElement | null>; sessionId: string }) {
  const { t } = useTranslation()
  const turns = useStore(timelineRegistry, (state) => state.turns)
  const registeredSessionId = useStore(timelineRegistry, (state) => state.sessionId)
  const terminals = useStore(timelineRegistry, (state) => state.terminals)
  const getViewport = useCallback(
    () => rootRef.current?.querySelector<HTMLElement>("[data-chat-scroll]") ?? null,
    [rootRef]
  )
  const findSourceMatches = useCallback(
    (query: string) => (registeredSessionId === sessionId ? findCodexSearchSourceMatches(turns, query, terminals) : []),
    [registeredSessionId, sessionId, turns, terminals]
  )
  const revealTurn = useCallback(
    (key: string, signal: AbortSignal) => revealTimelineTurn(sessionId, key, signal),
    [sessionId]
  )
  const prepareSource = useCallback(
    async (signal: AbortSignal) => {
      await client.loadHistoryNavigation(sessionId)
      const navigation = client.state.historyNavigation[sessionId]
      for (const turn of navigation?.turns ?? []) {
        if (signal.aborted) return
        if (!client.state.historyNavigation[sessionId]?.loadedTurnIds.includes(turn.turnId))
          await client.loadHistoryTurn(sessionId, turn.turnId)
      }
      const seen = new Set<string>()
      while (!signal.aborted) {
        const cursor = client.state.historyPages[sessionId]?.cursor
        if (cursor == null) return
        if (seen.has(cursor)) throw new Error("Chat history pagination returned a repeated cursor")
        seen.add(cursor)
        await client.loadOlderHistory(sessionId)
      }
    },
    [sessionId]
  )
  const subscribeOpen = useCallback(
    (open: () => void) => {
      const handler = (event: KeyboardEvent) => {
        if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
          if (document.activeElement?.closest(".alwith-editor")) return
          event.preventDefault()
          open()
        }
      }
      const requested = (event: Event) => {
        if ((event as CustomEvent<string>).detail === sessionId) open()
      }
      window.addEventListener(OPEN_SEARCH, requested)
      window.addEventListener("keydown", handler)
      const stopMenu = getCurrentWebviewWindow().listen<null>(events["menu:find-in-chat"].name, () => routeFind(open))
      return () => {
        window.removeEventListener(OPEN_SEARCH, requested)
        window.removeEventListener("keydown", handler)
        void stopMenu.then((stop) => stop())
      }
    },
    [sessionId]
  )
  return (
    <div className="absolute inset-x-0 top-0 z-30">
      <SharedChatSearch
        key={sessionId}
        placement="body"
        getViewport={getViewport}
        findSourceMatches={findSourceMatches}
        revealTurn={revealTurn}
        prepareSource={prepareSource}
        subscribeOpen={subscribeOpen}
        labels={{
          search: t("chat.search.label"),
          placeholder: t("chat.search.placeholder"),
          previous: t("chat.search.previous"),
          next: t("chat.search.next")
        }}
      />
    </div>
  )
}
