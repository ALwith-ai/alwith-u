import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { XIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ChatView } from "@/features/chat/chat-view"
import { DraftChat, DRAFT_SESSION_ID } from "@/features/chat/draft-chat"
import { chooseFolder } from "@/features/chat/draft-project-picker"
import { exportDraft, importDraft } from "@/features/chat/composer/drafts"
import { client, useApp, useSession } from "@/lib/client"
import {
  announceChatReady,
  presentChatWindow,
  requestChatSurface,
  serveChatSurface,
  type ChatTransfer
} from "@/lib/chat-window"
import { useWindowFocus } from "@/lib/window-focus"
import { useProviders } from "@/lib/use-providers"
import { openSettingsWindow } from "@/lib/window-manager"
import type { Preferences } from "@/lib/preferences"
import { WindowResizeEdges } from "./window-resize-edges"
import { resetZoom, zoomIn, zoomOut } from "@/lib/zoom"

import { useSurfaceOperation } from "@/lib/use-surface-operation"

function report(error: unknown): void {
  toast.error(error instanceof Error ? error.message : String(error))
}

export function ChatWindow({ preferences }: { preferences: Preferences }) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [cwd, setCwd] = useState<string | null>(preferences.lastProjectDirectory)
  const [generation, setGeneration] = useState(0)
  const [ready, setReady] = useState(false)
  const [headerTarget, setHeaderTarget] = useState<HTMLDivElement | null>(null)
  const current = useRef({ selectedId, cwd })
  current.current = { selectedId, cwd }
  const connection = useApp(state => state.connection)
  const session = useSession(selectedId)
  const runState = useApp(state => (selectedId === null ? null : state.runStates[selectedId]?.state))
  const focused = useWindowFocus()
  const providers = useProviders()
  const { busy, operation } = useSurfaceOperation()

  const capture = useCallback(async (): Promise<ChatTransfer> => {
    const { selectedId, cwd } = current.current
    return { sessionId: selectedId, cwd, draft: await exportDraft(selectedId ?? DRAFT_SESSION_ID) }
  }, [])

  const reconnect = useCallback(async (): Promise<void> => {
    await client.connect()
    const { selectedId, cwd } = current.current
    if (selectedId !== null && !client.state.sessions[selectedId]) {
      if (cwd === null) throw new Error("A chat session must have a working directory")
      await client.open(selectedId, cwd)
    }
  }, [])

  const hide = useCallback(async (): Promise<void> => {
    await getCurrentWebviewWindow().hide()
  }, [])
  const newChat = useCallback(() => {
    if (operation.busy) return
    setSelectedId(null)
    importDraft(DRAFT_SESSION_ID, null)
    setGeneration(value => value + 1)
  }, [operation])

  const newProject = useCallback(() => {
    void operation
      .run(async () => {
        const directory = await chooseFolder(current.current.cwd)
        if (directory === null) return
        setCwd(directory)
        setSelectedId(null)
        importDraft(DRAFT_SESSION_ID, null)
        setGeneration(value => value + 1)
      })
      .catch(report)
  }, [operation])

  const deleted = useCallback(
    (sessionId: string) => {
      if (current.current.selectedId === sessionId) newChat()
    },
    [newChat]
  )

  useEffect(() => {
    let disposed = false
    let stopSurface: (() => void) | undefined
    const win = getCurrentWebviewWindow()
    const close = win.onCloseRequested(event => {
      event.preventDefault()
      void hide().catch(report)
    })
    const menu = win.listen("menu:new-chat", newChat)
    const zoom = Promise.all([
      win.listen("menu:zoom-in", () => void zoomIn().catch(report)),
      win.listen("menu:zoom-out", () => void zoomOut().catch(report)),
      win.listen("menu:actual-size", () => void resetZoom().catch(report)),
      win.listen("menu:open-settings", () => void openSettingsWindow().catch(report))
    ])
    void (async () => {
      await client.connect()
      if (disposed) return
      stopSurface = await serveChatSurface(action =>
        operation.run(async () => {
          switch (action.type) {
            case "present": {
              if (action.transfer) await client.connect()
              else await reconnect()
              if (action.transfer) {
                const transfer = action.transfer
                if (transfer.sessionId !== null) {
                  if (transfer.cwd === null) throw new Error("A chat session must have a working directory")
                  await client.open(transfer.sessionId, transfer.cwd)
                }
                importDraft(transfer.sessionId ?? DRAFT_SESSION_ID, transfer.draft)
                setCwd(transfer.cwd)
                setSelectedId(transfer.sessionId)
                setGeneration(value => value + 1)
              }
              await presentChatWindow()
              return null
            }
            case "release": {
              if (current.current.selectedId !== action.sessionId) return null
              const transfer = await capture()
              await hide()
              setSelectedId(null)
              setGeneration(value => value + 1)
              return transfer
            }
            default:
              throw new Error("Unsupported chat window action")
          }
        })
      )
      if (disposed) {
        stopSurface()
        return
      }
      setReady(true)
      await announceChatReady()
    })().catch(error => {
      if (!disposed) report(error)
    })
    return () => {
      disposed = true
      stopSurface?.()
      void close.then(stop => stop())
      void menu.then(stop => stop())
      void zoom.then(stops => {
        for (const stop of stops) stop()
      })
      client.disconnect()
    }
  }, [capture, hide, newChat, operation, reconnect])

  useEffect(() => {
    if (focused && selectedId !== null && runState === "done") {
      void requestChatSurface("main", { type: "markRead", sessionId: selectedId }).catch(report)
    }
  }, [focused, selectedId, runState])

  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      // Dialogs and IME own Escape first; a plain Escape dismisses the window.
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !event.isComposing &&
        !document.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')
      ) {
        event.preventDefault()
        void hide().catch(report)
      }
    }
    window.addEventListener("keydown", keydown)
    return () => window.removeEventListener("keydown", keydown)
  }, [hide])

  return (
    <main
      inert={busy}
      aria-busy={busy}
      className="bg-background text-foreground relative flex h-dvh flex-col overflow-hidden rounded-2xl border">
      <WindowResizeEdges />
      <header className="flex h-11 shrink-0 items-center gap-1 px-3" data-tauri-drag-region>
        <div ref={setHeaderTarget} className="flex min-w-0 flex-1 items-center gap-1" data-tauri-drag-region />
        <Button
          variant="ghost"
          size="icon-sm"
          title={t("actions.close")}
          aria-label={t("actions.close")}
          onClick={() => void hide().catch(report)}>
          <XIcon />
        </Button>
      </header>
      {ready &&
        (connection === "disconnected" || connection === "failed" || (selectedId !== null && session === null)) && (
          <div className="flex items-center justify-between gap-2 px-4 py-2 text-sm" role="status">
            <span>{t("connection.disconnected")}</span>
            <Button variant="outline" size="sm" onClick={() => void operation.run(reconnect).catch(report)}>
              {t("connection.reconnect")}
            </Button>
          </div>
        )}
      <div className="min-h-0 flex-1">
        {ready &&
          (selectedId === null ? (
            <DraftChat
              headerTarget={headerTarget}
              onNewChat={newChat}
              onNewProject={newProject}
              runOperation={operation.run}
              key={`draft-${generation}`}
              cwd={cwd}
              onCwdChange={setCwd}
              onCreated={setSelectedId}
              onAuthRequired={() => void openSettingsWindow("provider")}
              providerSnapshot={providers}
            />
          ) : session !== null ? (
            <ChatView
              key={`${session.id}-${generation}`}
              session={session}
              headerTarget={headerTarget}
              onNewChat={newChat}
              onNewProject={newProject}
              onDeleted={deleted}
            />
          ) : null)}
      </div>
    </main>
  )
}
