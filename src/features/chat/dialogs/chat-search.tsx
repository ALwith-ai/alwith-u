import { ChatSearch as SharedChatSearch } from "@alwith/module-chat/search"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { type RefObject, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"
import { findCodexSearchSourceMatches } from "../lib/codex-search-source"
import { revealThreadTurn, threadRegistry } from "../lib/thread-registry"
import "./chat-search.css"

const OPEN_SEARCH = "chat:find"

export function openChatSearch(sessionId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH, { detail: sessionId }))
}

export function ChatSearch({ rootRef, sessionId }: { rootRef: RefObject<HTMLElement | null>; sessionId: string }) {
  const { t } = useTranslation()
  const turns = useStore(threadRegistry, state => state.turns)
  const registeredSessionId = useStore(threadRegistry, state => state.sessionId)
  const getViewport = useCallback(
    () => rootRef.current?.querySelector<HTMLElement>("[data-chat-scroll]") ?? null,
    [rootRef]
  )
  const findSourceMatches = useCallback(
    (query: string) => (registeredSessionId === sessionId ? findCodexSearchSourceMatches(turns, query) : []),
    [registeredSessionId, sessionId, turns]
  )
  const revealTurn = useCallback(
    (key: string, signal: AbortSignal) => revealThreadTurn(sessionId, key, signal),
    [sessionId]
  )
  const subscribeOpen = useCallback(
    (open: () => void) => {
      const handler = (event: KeyboardEvent) => {
        if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
          event.preventDefault()
          open()
        }
      }
      const requested = (event: Event) => {
        if ((event as CustomEvent<string>).detail === sessionId) open()
      }
      window.addEventListener(OPEN_SEARCH, requested)
      window.addEventListener("keydown", handler)
      const stopMenu = getCurrentWebviewWindow().listen("menu:find-in-chat", open)
      return () => {
        window.removeEventListener(OPEN_SEARCH, requested)
        window.removeEventListener("keydown", handler)
        void stopMenu.then(stop => stop())
      }
    },
    [sessionId]
  )
  return (
    <SharedChatSearch
      key={sessionId}
      placement="body"
      getViewport={getViewport}
      findSourceMatches={findSourceMatches}
      revealTurn={revealTurn}
      subscribeOpen={subscribeOpen}
      labels={{
        search: t("chat.search.label"),
        placeholder: t("chat.search.placeholder"),
        previous: t("chat.search.previous"),
        next: t("chat.search.next")
      }}
    />
  )
}
