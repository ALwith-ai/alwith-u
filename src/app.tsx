import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { info } from "@tauri-apps/plugin-log"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"
import type { ThreadSummary } from "@/agent/client"
import { hasAccount } from "@/agent/codex-extensions"
import { events } from "@/bindings"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { SidebarInset } from "@/components/ui/sidebar"
import { WallpaperBackground } from "@/features/appearance/wallpaper/background"
import { ActionCard } from "@/features/chat/action-card"
import { ChatView } from "@/features/chat/chat-view"
import { exportDraft, importDraft } from "@/features/chat/composer/drafts"
import { DRAFT_SESSION_ID, DraftChat } from "@/features/chat/draft-chat"
import { ProjectSessionPopover } from "@/features/chat/project-session-popover"
import { ExtensionActions, ExtensionStatusBar } from "@/features/extensions/extension-outlets"
import { ExtensionMount, ExtensionPage } from "@/features/extensions/extension-view"
import { ExtensionsSection } from "@/features/extensions/extensions-section"
import { connectLegacyNavigation } from "@/features/extensions/legacy/navigation"
import { assertLegacySkills } from "@/features/extensions/legacy/skills"
import { reportExtensionError, useExtensions } from "@/features/extensions/runtime"
import { ClientVersionPopover } from "@/features/layout/components/client-version-popover"
import { MainSidebarLayout } from "@/features/layout/components/main-sidebar-layout"
import { CommandPalette } from "@/features/palette/command-palette"
import { PluginsPage } from "@/features/plugins/plugins-page"
import { HotkeysDialog } from "@/features/settings/hotkeys-dialog"
import { StoryPage } from "@/features/story/story-page"
import { selectThread } from "@/features/threads/select-thread"
import { ThreadSidebar } from "@/features/threads/thread-sidebar"
import { installChatShortcut } from "@/lib/chat-shortcut"
import { openChatWindow, releaseChatWindow, serveChatSurface, setChatWindowHostReady } from "@/lib/chat-window"
import { serveChatClient } from "@/lib/chat-window-client"
import { client, markRead, useApp, useSession, watchRunStates } from "@/lib/client"
import { watchForNotifications } from "@/lib/notifications"
import { type Preferences, savePreference } from "@/lib/preferences"
import { applyProviders } from "@/lib/providers"
import { onHubExit } from "@/lib/runtime"
import { serveSettingsBridge } from "@/lib/settings-bridge"
import { useProviders } from "@/lib/use-providers"
import { useReadVisibleSession } from "@/lib/use-read-visible-session"
import { useSurfaceOperation } from "@/lib/use-surface-operation"
import { useWindowFocus } from "@/lib/window-focus"
import { openSettingsWindow } from "@/lib/window-manager"
import { resetZoom, zoomIn, zoomOut } from "@/lib/zoom"

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function App({ initialPreferences }: { initialPreferences: Preferences }) {
  const { host: extensions } = useExtensions()
  const { t } = useTranslation()
  const connection = useApp(state => state.connection)
  const connectionError = useApp(state => state.connectionError)
  const globalActions = useApp(useShallow(state => state.actions.filter(action => action.sessionId === null)))
  // Launch lands on the home screen like the official app; no thread is resumed until the
  // user opens one.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [surfaceGeneration, setSurfaceGeneration] = useState(0)
  const [lastDirectory, setLastDirectory] = useState<string | null>(initialPreferences.lastProjectDirectory)
  const providerSnapshot = useProviders()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  // Management pages share the leading screen; the offscreen chat stays mounted.
  const [view, setView] = useState<"chat" | "plugins" | "extensions" | "story" | "extension">("chat")
  const [leadingPage, setLeadingPage] = useState<"plugins" | "extensions">("plugins")
  const leading = view === "plugins" || view === "extensions" || view === "extension"
  const [extensionView, setExtensionView] = useState<string | null>(null)
  const openExtension = useCallback((id: string): void => {
    setExtensionView(id)
    setLeadingPage("extensions")
    setView("extension")
  }, [])
  const [pluginsVisited, setPluginsVisited] = useState(false)
  const openPlugins = useCallback(() => {
    setPluginsVisited(true)
    setLeadingPage("plugins")
    setView("plugins")
  }, [])
  const openExtensions = useCallback(() => {
    setLeadingPage("extensions")
    setView("extensions")
  }, [])
  const session = useSession(selectedId)
  const legacySession = useRef(session)
  legacySession.current = session
  useEffect(
    () =>
      connectLegacyNavigation({
        currentSession: () => {
          const selected = legacySession.current
          return selected?.attached
            ? { id: selected.id, cwd: selected.cwd, title: selected.title ?? selected.id }
            : null
        },
        openView: openExtension,
        send: async (id, text, required) => {
          if (required.length) {
            const target = client.state.sessions[id]
            if (!target?.attached || target.readOnly)
              throw new Error("已绑定会话当前不可写，请重新打开会话后再操作扩展")
            const catalog = await client.listSkills([target.cwd], true)
            assertLegacySkills(
              required,
              catalog.data.flatMap(entry => entry.skills)
            )
          }
          await client.prompt(id, [{ type: "text", text }])
        }
      }),
    [openExtension]
  )
  const focused = useWindowFocus()
  const { busy, operation } = useSurfaceOperation()

  useReadVisibleSession(selectedId, focused && view === "chat")

  const select = useCallback(
    (thread: ThreadSummary) => {
      // Codex refuses to resume an archived thread; opening one restores it first, as the
      // official client does.
      void operation
        .run(() =>
          selectThread(thread, {
            connect: () => client.connect(),
            unarchive: id => client.unarchive(id),
            release: releaseChatWindow,
            importDraft,
            open: (id, cwd) => client.open(id, cwd),
            show: id => {
              setSurfaceGeneration(value => value + 1)
              setView("chat")
              setSelectedId(id)
            },
            onOpenError: (error: unknown) => toast.error(describe(error))
          })
        )
        .catch((error: unknown) => toast.error(describe(error)))
    },
    [operation]
  )

  // "New chat" returns to the empty draft, as in Desktop; the session is created on the
  // first send (DraftChat), never by opening a folder dialog here.
  const newChat = useCallback(() => {
    if (operation.busy) return
    setView("chat")
    setSelectedId(null)
  }, [operation])

  const chooseDraftFolder = useCallback((directory: string) => {
    setLastDirectory(directory)
    void savePreference("lastProjectDirectory", directory)
  }, [])

  const draftCreated = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  useEffect(() => {
    let disposed = false
    const shortcut = installChatShortcut(() => {
      void openChatWindow().catch(error => toast.error(describe(error)))
    })
    const ready = (async () => {
      const stopClient = await serveChatClient(client, undefined, error => toast.error(describe(error)))
      const stopSurface = await serveChatSurface(async action => {
        switch (action.type) {
          case "markRead":
            await markRead(action.sessionId)
            return null
          case "shortcut":
            await shortcut.set(action.shortcut)
            return null
          default:
            throw new Error("Unsupported main window action")
        }
      })
      if (disposed) {
        stopClient()
        stopSurface()
        return () => {}
      }
      void shortcut
        .set(initialPreferences.chatWindowShortcut ?? "Alt+Space", false)
        .catch(error => toast.error(describe(error)))
      return () => {
        stopClient()
        stopSurface()
      }
    })()
    setChatWindowHostReady(ready)
    return () => {
      disposed = true
      void ready.then(stop => stop()).catch(error => toast.error(describe(error)))
      void shortcut.dispose().catch(error => toast.error(describe(error)))
    }
  }, [initialPreferences.chatWindowShortcut])

  // Run states come over the Runtime port; a new port (after alwith-runtime restarted) needs a
  // new subscription, so the watch is restarted with every connect.
  const connect = useCallback(async () => {
    try {
      await client.connect()
      // Providers join the model pickers before any thread opens, so a thread the user moved
      // to one of them resumes there.
      client.setGatewayModels(initialPreferences.sessionModels)
      void applyProviders().catch((error: unknown) => toast.error(describe(error)))
      await client.listThreads({ reset: true })
      const threads = client.state.threads
      void info(
        `connected to ${client.state.agent?.info.name} ${client.state.agent?.info.version}, ${threads.length} threads`
      )
    } catch (error) {
      toast.error(describe(error))
    }
  }, [initialPreferences.sessionModels])

  // Either window can reconnect the owner; refresh Runtime subscriptions for every ready port.
  useEffect(() => {
    if (connection !== "ready") return
    const stop = watchRunStates()
    void stop.catch((error: unknown) => toast.error(describe(error)))
    return () => {
      void stop.then(
        unsubscribe => unsubscribe(),
        () => undefined
      )
    }
  }, [connection])

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
        const agent = client.state.agent
        if (client.state.connection !== "ready" || !agent?.info) return null
        return {
          name: agent.info.title ?? agent.info.name,
          version: agent.info.version,
          authMethods: agent.authMethods ?? [],
          actions: client.state.actions.filter(action => action.sessionId === null)
        }
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
    return stopBridge
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
      void stopHubExit.then(stop => stop())
    }
  }, [connect, t])

  // Native menu items (macOS, Linux) arrive as events; where there is no native menu
  // (Windows) the keyboard handler below covers the same shortcuts.
  useEffect(() => {
    const webview = getCurrentWebviewWindow()
    const listeners = Promise.all([
      webview.listen<null>(events["menu:new-chat"].name, () => void newChat()),
      webview.listen<null>(events["menu:open-settings"].name, () => void openSettingsWindow()),
      webview.listen<null>(events["menu:command-palette"].name, () => setPaletteOpen(open => !open)),
      webview.listen<null>(events["menu:open-hotkeys"].name, () => setHotkeysOpen(true)),
      webview.listen<null>(events["menu:zoom-in"].name, () => void zoomIn()),
      webview.listen<null>(events["menu:zoom-out"].name, () => void zoomOut()),
      webview.listen<null>(events["menu:actual-size"].name, () => void resetZoom())
    ])
    return () => {
      void listeners.then(stops => {
        for (const stop of stops) stop()
      })
    }
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
    if (view === "story") return <StoryPage />
    // Keyed: the thread and the composer keep per-session state (draft, scroll memory) and start fresh per session.
    const moveToWindow = (): void => {
      void operation
        .run(async () => {
          await openChatWindow({
            sessionId: selectedId,
            cwd: session?.cwd ?? lastDirectory,
            draft: await exportDraft(selectedId ?? DRAFT_SESSION_ID)
          })
          setSelectedId(null)
          importDraft(DRAFT_SESSION_ID, null)
          setSurfaceGeneration(value => value + 1)
        })
        .catch(error => toast.error(describe(error)))
    }
    const newProjectChat = (): void => {
      if (operation.busy) return
      if (session !== null) chooseDraftFolder(session.cwd)
      importDraft(DRAFT_SESSION_ID, null)
      setSurfaceGeneration(value => value + 1)
      newChat()
    }
    const deleted = (sessionId: string): void => {
      setSelectedId(current => (current === sessionId ? null : current))
    }
    if (session !== null)
      return (
        <ChatView
          key={`${session.id}-${surfaceGeneration}`}
          session={session}
          projectMenu={<ProjectSessionPopover cwd={session.cwd} onSelect={select} onNewChat={newProjectChat} />}
          onSelectThread={select}
          onOpenWindow={moveToWindow}
          onNewChat={newProjectChat}
          onDeleted={deleted}
        />
      )
    return (
      <>
        {connectionNotice}
        <DraftChat
          key={`draft-${surfaceGeneration}`}
          onNewChat={newProjectChat}
          cwd={lastDirectory}
          projectMenu={
            lastDirectory === null ? null : (
              <ProjectSessionPopover cwd={lastDirectory} onSelect={select} onNewChat={newProjectChat} />
            )
          }
          onCwdChange={chooseDraftFolder}
          onCreated={draftCreated}
          onAuthRequired={() => void openSettingsWindow("provider")}
          providerSnapshot={providerSnapshot}
          runOperation={operation.run}
          onOpenWindow={moveToWindow}
        />
      </>
    )
  })()

  const actionCards = globalActions.length > 0 && (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 pt-12">
      {globalActions.map(action => (
        <ActionCard key={action.id} action={action} />
      ))}
    </div>
  )

  return (
    <div className="h-full" inert={busy} aria-busy={busy}>
      <WallpaperBackground onError={reportExtensionError}>
        <MainSidebarLayout
          initialPinned={initialPreferences.sidebarPinned}
          screen={leading ? "leading" : "main"}
          sidebar={
            <ThreadSidebar
              screen={leading ? "leading" : "main"}
              leadingPage={leadingPage}
              selectedId={leading ? null : selectedId}
              onSelect={select}
              onNewChat={newChat}
              onSearch={() => setPaletteOpen(true)}
              onOpenWindow={() => void openChatWindow().catch(error => toast.error(describe(error)))}
              onNewProjectChat={cwd => {
                if (operation.busy) return
                chooseDraftFolder(cwd)
                importDraft(DRAFT_SESSION_ID, null)
                setSurfaceGeneration(value => value + 1)
                newChat()
              }}
              onOpenSettings={() => void openSettingsWindow()}
              onOpenPlugins={openPlugins}
              onOpenExtensions={openExtensions}
              extensionNavigation={
                <ExtensionActions
                  host={extensions}
                  placement="navigation"
                  activeView={view === "extension" ? extensionView : null}
                  onOpenSurface={openExtension}
                  onError={reportExtensionError}
                />
              }
              onSwitchScreen={() => {
                if (leading) setView("chat")
                else if (leadingPage === "extensions") openExtensions()
                else openPlugins()
              }}
            />
          }
          leading={
            <SidebarInset className="main-chat-surface flex min-h-0 flex-col">
              {leading && actionCards}
              {pluginsVisited && (
                <div className={leadingPage === "plugins" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                  <PluginsPage cwd={session?.cwd ?? lastDirectory} active={view === "plugins"} />
                </div>
              )}
              {view === "extension" && extensionView !== null ? (
                <ExtensionPage id={extensionView} onClose={openExtensions} />
              ) : leadingPage === "extensions" ? (
                <div className="min-h-0 flex-1 overflow-auto">
                  <div className="mx-auto w-full max-w-5xl px-6 py-8">
                    <ExtensionsSection onOpenSurface={openExtension} />
                  </div>
                </div>
              ) : null}
            </SidebarInset>
          }
          main={
            <SidebarInset className="main-chat-surface flex min-h-0 flex-col">
              {!leading && actionCards}
              {main}
            </SidebarInset>
          }>
          <HotkeysDialog open={hotkeysOpen} onOpenChange={setHotkeysOpen} />
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            onNewChat={newChat}
            onOpenSettings={() => void openSettingsWindow()}
            onOpenPlugins={openPlugins}
            onOpenHotkeys={() => setHotkeysOpen(true)}
            onOpenExtension={openExtension}
            onSelect={select}
          />
          <div className="main-chat-drag-region absolute top-0 z-20 h-8" data-tauri-drag-region aria-hidden="true" />
          <div className="main-extension-toolbar pointer-events-none absolute top-0 z-40 flex h-8 items-center [-webkit-app-region:no-drag]">
            <ExtensionActions
              host={extensions}
              placement="topBar"
              onOpenSurface={openExtension}
              onError={reportExtensionError}
            />
          </div>
          <div className="main-extension-status pointer-events-none absolute bottom-0 z-20 [-webkit-app-region:no-drag]">
            <ExtensionStatusBar views={extensions.views} renderView={item => <ExtensionMount id={item.id} />} />
          </div>
          <div className="absolute end-2 bottom-0 z-20">
            <ClientVersionPopover />
          </div>
        </MainSidebarLayout>
      </WallpaperBackground>
    </div>
  )
}
