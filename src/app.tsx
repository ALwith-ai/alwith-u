import { listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { info } from "@tauri-apps/plugin-log"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import type { ThreadSummary } from "@/agent/client"
import { ActionCard } from "@/features/chat/action-card"
import { ChatView } from "@/features/chat/chat-view"
import { DraftChat } from "@/features/chat/draft-chat"
import { PluginsPage } from "@/features/plugins/plugins-page"
import { CommandPalette } from "@/features/palette/command-palette"
import { HotkeysDialog } from "@/features/settings/hotkeys-dialog"
import { ThreadSidebar } from "@/features/threads/thread-sidebar"
import { client, markRead, useApp, useSession, watchRunStates } from "@/lib/client"
import { applyProviders } from "@/lib/providers"
import { onHubExit } from "@/lib/runtime"
import { watchForNotifications } from "@/lib/notifications"
import { PREFERENCES_CHANGED, type PreferenceChange, savePreference, type Preferences } from "@/lib/preferences"
import { hasAccount } from "@/agent/codex-extensions"
import { serveSettingsBridge } from "@/lib/settings-bridge"
import { openSettingsWindow } from "@/lib/window-manager"
import { resetZoom, zoomIn, zoomOut } from "@/lib/zoom"

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function App({ initialPreferences }: { initialPreferences: Preferences }) {
  const { t } = useTranslation()
  const connection = useApp(state => state.connection)
  const connectionError = useApp(state => state.connectionError)
  const globalActions = useApp(useShallow(state => state.actions.filter(action => action.sessionId === null)))
  // Launch lands on the home screen like the official app; no thread is resumed until the
  // user opens one.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lastDirectory, setLastDirectory] = useState<string | null>(initialPreferences.lastProjectDirectory)
  const [providerKeys, setProviderKeys] = useState(initialPreferences.providerKeys)
  const providerKeysRef = useRef(providerKeys)
  providerKeysRef.current = providerKeys
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  // What the main area shows: the selected chat, or the skills and plugins store.
  const [view, setView] = useState<"chat" | "plugins">("chat")
  const session = useSession(selectedId)
  const stopRunStates = useRef<Promise<() => void> | null>(null)
  const selectedRunState = useApp(state => (selectedId === null ? null : (state.runStates[selectedId]?.state ?? null)))

  // The selected chat is being looked at: `done` becomes `idle` for every client of this Runtime.
  useEffect(() => {
    if (selectedId !== null && selectedRunState === "done")
      void markRead(selectedId).catch((error: unknown) => toast.error(describe(error)))
  }, [selectedId, selectedRunState])

  const select = useCallback((thread: ThreadSummary) => {
    setView("chat")
    setSelectedId(thread.sessionId)
    // Codex refuses to resume an archived thread; opening one restores it first, as the
    // official client does.
    const restored = client.connect().then(() => (thread.archived ? client.unarchive(thread.sessionId) : undefined))
    restored
      .then(() => client.open(thread.sessionId, thread.cwd))
      .catch((error: unknown) => toast.error(describe(error)))
  }, [])

  // "New chat" returns to the empty draft, as in Desktop; the session is created on the
  // first send (DraftChat), never by opening a folder dialog here.
  const newChat = useCallback(() => {
    setView("chat")
    setSelectedId(null)
  }, [])

  const chooseDraftFolder = useCallback((directory: string) => {
    setLastDirectory(directory)
    void savePreference("lastProjectDirectory", directory)
  }, [])

  const draftCreated = useCallback((id: string) => {
    setView("chat")
    setSelectedId(id)
  }, [])

  // Run states come over the Runtime port; a new port (after alwith-runtime restarted) needs a
  // new subscription, so the watch is restarted with every connect.
  const connect = useCallback(async () => {
    try {
      await client.connect()
      // Providers join the model pickers before any thread opens, so a thread the user moved
      // to one of them resumes there.
      client.setGatewayModels(initialPreferences.sessionModels)
      await applyProviders(providerKeysRef.current)
      void stopRunStates.current?.then(stop => stop())
      stopRunStates.current = watchRunStates().catch((error: unknown) => {
        toast.error(describe(error))
        return () => undefined
      })
      await client.listThreads({ reset: true })
      const threads = client.state.threads
      void info(
        `connected to ${client.state.agent?.info.name} ${client.state.agent?.info.version}, ${threads.length} threads`
      )
    } catch (error) {
      toast.error(describe(error))
    }
  }, [initialPreferences.sessionModels])

  // Remember which chats run on a gateway model, so they reopen there after a restart.
  useEffect(() => {
    const models = { ...initialPreferences.sessionModels }
    return client.onSessionModel((sessionId, modelId, isGateway) => {
      if (isGateway) models[sessionId] = modelId
      else delete models[sessionId]
      void savePreference("sessionModels", models)
    })
  }, [initialPreferences.sessionModels])

  // The settings window has no agent connection of its own: it asks this window for the
  // engine identity and for sign-out, and provider keys saved there are applied here.
  useEffect(() => {
    const stopBridge = serveSettingsBridge({
      agent: () => {
        if (client.state.connection !== "ready") return null
        const info = client.state.agent?.info
        return info
          ? {
              name: info.title ?? info.name,
              version: info.version,
              authMethods: client.state.agent!.authMethods ?? [],
              actions: client.state.actions.filter(action => action.sessionId === null)
            }
          : null
      },
      subscribe: listener => client.store.subscribe(listener),
      logout: () => client.logout(),
      login: (methodId, extra) => client.login(methodId, extra),
      respond: (actionId, answer) => client.respond(actionId, answer),
      account: async () => {
        if (client.state.connection !== "ready" || !hasAccount(client.state.agent)) return null
        const [account, rateLimits] = await Promise.all([
          client.readAccount(),
          client.readRateLimits().catch(() => null)
        ])
        return { account, rateLimits }
      },
      onRateLimits: listener => client.onRateLimits(listener)
    })
    const stopKey = listen<PreferenceChange>(PREFERENCES_CHANGED, event => {
      if (event.payload.key !== "providerKeys") return
      const keys = event.payload.value as Preferences["providerKeys"]
      setProviderKeys(keys)
      applyProviders(keys).catch((error: unknown) => toast.error(describe(error)))
    })
    return () => {
      stopBridge()
      void stopKey.then(stop => stop())
    }
  }, [])

  useEffect(() => {
    void connect()
    const stopNotifications = watchForNotifications(client)
    // alwith-runtime gone: the port is reset, the client drops to "disconnected", and Reconnect
    // asks Rust for a fresh alwith-runtime.
    const stopHubExit = onHubExit(exit => {
      toast.error(t("connection.runtimeExited", { code: exit.code ?? exit.signal ?? "?" }))
      client.disconnect()
    })
    return () => {
      stopNotifications()
      void stopRunStates.current?.then(stop => stop())
      void stopHubExit.then(stop => stop())
    }
  }, [connect, t])

  // Native menu items (macOS, Linux) arrive as events; where there is no native menu
  // (Windows) the keyboard handler below covers the same shortcuts.
  useEffect(() => {
    const webview = getCurrentWebviewWindow()
    const listeners = Promise.all([
      webview.listen("menu:new-chat", () => void newChat()),
      webview.listen("menu:open-settings", () => void openSettingsWindow()),
      webview.listen("menu:command-palette", () => setPaletteOpen(open => !open)),
      webview.listen("menu:open-hotkeys", () => setHotkeysOpen(true)),
      webview.listen("menu:zoom-in", () => void zoomIn()),
      webview.listen("menu:zoom-out", () => void zoomOut()),
      webview.listen("menu:actual-size", () => void resetZoom())
    ])
    return () => void listeners.then(stops => stops.forEach(stop => stop()))
  }, [newChat])

  useEffect(() => {
    if (!/Win/.test(navigator.platform)) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return
      if (event.key === "n") {
        event.preventDefault()
        void newChat()
      } else if (event.key === "k") {
        event.preventDefault()
        setPaletteOpen(open => !open)
      } else if (event.key === ",") {
        event.preventDefault()
        void openSettingsWindow()
      } else if (event.key === "=" || event.key === "+") {
        event.preventDefault()
        void zoomIn()
      } else if (event.key === "-") {
        event.preventDefault()
        void zoomOut()
      } else if (event.key === "0") {
        event.preventDefault()
        void resetZoom()
      } else if (event.key === "/") {
        event.preventDefault()
        setHotkeysOpen(true)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [newChat])

  const main = (() => {
    // The engine starts in the background; the home screen is there from the first frame, as
    // in Desktop and the official app. Only a failed or dropped connection says so, inline.
    const connectionNotice =
      connection === "failed" || connection === "disconnected" ? (
        <div className="mx-auto w-full max-w-3xl px-6 pt-12">
          <Alert variant="destructive">
            <AlertTitle>{connection === "failed" ? t("connection.failed") : t("connection.disconnected")}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              {connectionError !== null && <span className="font-mono">{connectionError}</span>}
              <Button size="sm" variant="outline" onClick={() => void connect()}>
                {t("connection.reconnect")}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : null
    if (view === "plugins") return <PluginsPage cwd={session?.cwd ?? lastDirectory} />
    if (session !== null) return <ChatView session={session} />
    return (
      <>
        {connectionNotice}
        <DraftChat
          cwd={lastDirectory}
          onCwdChange={chooseDraftFolder}
          onCreated={draftCreated}
          onAuthRequired={() => void openSettingsWindow("provider")}
          providerKeys={providerKeys}
        />
      </>
    )
  })()

  return (
    <SidebarProvider className="h-full">
      <ThreadSidebar
        selectedId={selectedId}
        onSelect={select}
        onNewChat={newChat}
        onOpenSettings={() => void openSettingsWindow()}
        onOpenPlugins={() => setView("plugins")}
      />
      <SidebarInset className="bg-background flex h-full min-h-0 flex-col">
        {globalActions.length > 0 && (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 pt-12">
            {globalActions.map(action => (
              <ActionCard key={action.id} action={action} />
            ))}
          </div>
        )}
        {main}
      </SidebarInset>
      <HotkeysDialog open={hotkeysOpen} onOpenChange={setHotkeysOpen} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNewChat={newChat}
        onOpenSettings={() => void openSettingsWindow()}
        onOpenPlugins={() => setView("plugins")}
        onOpenHotkeys={() => setHotkeysOpen(true)}
        onSelect={select}
      />
    </SidebarProvider>
  )
}
