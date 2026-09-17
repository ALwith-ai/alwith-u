import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { ChatSearch as SharedChatSearch } from "@alwith/module-chat/search"
import { type RefObject, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"
import { findCodexSearchSourceMatches } from "../lib/codex-search-source"
import { revealThreadTurn, threadRegistry } from "../lib/thread-registry"
import "./chat-search.css"
export { collectMatches } from "@alwith/module-chat/search"

export function ChatSearch({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation()
  const turns = useStore(threadRegistry, state => state.turns)
  const sessionId = useStore(threadRegistry, state => state.sessionId)
  const getViewport = useCallback(
    () => rootRef.current?.querySelector<HTMLElement>("[data-chat-scroll]") ?? null,
    [rootRef]
  )
  const findSourceMatches = useCallback((query: string) => findCodexSearchSourceMatches(turns, query), [turns])
  const revealTurn = useCallback((key: string, signal: AbortSignal) => revealThreadTurn(sessionId, key, signal), [sessionId])
  const subscribeOpen = useCallback((open: () => void) => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault()
        open()
      }
    }
    window.addEventListener("keydown", handler)
    const stopMenu = getCurrentWebviewWindow().listen("menu:find-in-chat", open)
    return () => {
      window.removeEventListener("keydown", handler)
      void stopMenu.then(stop => stop())
    }
  }, [])
  return (
    <SharedChatSearch
      key={sessionId}
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
