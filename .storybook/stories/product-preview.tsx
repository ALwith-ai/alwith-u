import { PetQuickReply, PetWindow } from "@alwith/module-auth/pets/react"
import { exportDraft } from "@alwith/module-chat/conversation"
import type { FormAction } from "@alwith/module-chat/conversation"
import { isFormElicitation } from "@nyssance/codex-acp-v2/client"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { toast, Toaster } from "sonner"

import type { SessionSummary } from "../../src/agent/client"
import { WindowsMainWindowShell } from "../../src/components/alwith-ui/windows-main-window-shell"
import { Alert, AlertDescription, AlertTitle } from "../../src/components/ui/alert"
import { Button } from "../../src/components/ui/button"
import { SidebarInset } from "../../src/components/ui/sidebar"
import { WallpaperBackground } from "../../src/features/appearance/wallpaper/background"
import { ZoomFeedback } from "../../src/features/appearance/zoom-feedback"
import { AuthGate } from "../../src/features/auth/auth-gate"
import { ChatWindow } from "../../src/features/chat-window/chat-window"
import { ActionCard, ElicitationFormDialog } from "../../src/features/chat/action-card"
import { ChatView } from "../../src/features/chat/chat-view"
import { DRAFT_SESSION_ID, DraftChat } from "../../src/features/chat/draft-chat"
import { ChatProjectMenu } from "../../src/features/chat/project-session-popover"
import { DriveDeleteConfirmation, DrivePage, DriveStatus } from "../../src/features/drive/drive"
import { ExtensionNavigation } from "../../src/features/extensions/extension-navigation"
import { ExtensionStatusBar } from "../../src/features/extensions/extension-outlets"
import { ExtensionMount, ExtensionPage } from "../../src/features/extensions/extension-view"
import { ExtensionsSection } from "../../src/features/extensions/extensions-section"
import { GamepadWindow } from "../../src/features/gamepad/gamepad-window"
import { GuidePage } from "../../src/features/guide/guide-page"
import { ClientVersionPopover } from "../../src/features/layout/components/client-version-popover"
import { LeadingNavigation } from "../../src/features/layout/components/leading-navigation"
import { MainSidebarLayout } from "../../src/features/layout/components/main-sidebar-layout"
import { CommandPalette } from "../../src/features/palette/command-palette"
import { PluginDetailPage } from "../../src/features/plugins/plugin-detail-page"
import { PluginIconDefinitions } from "../../src/features/plugins/plugin-icon"
import { PluginsPage } from "../../src/features/plugins/plugins-page"
import { ArchivedChatsPage } from "../../src/features/sessions/archived-chats-page"
import { SessionSidebar } from "../../src/features/sessions/session-sidebar"
import { HotkeysDialog } from "../../src/features/settings/hotkeys-dialog"
import { SettingsPage } from "../../src/features/settings/settings-page"
import { VibemonCenter } from "../../src/features/vibemon/pet-center"
import { useWorkspace, WorkspaceHeaderContext } from "../../src/features/workspace/context"
import { FileWorkspace } from "../../src/features/workspace/file-workspace"
import { PROJECT_DIRECTORY } from "../fixtures/catalog"
import { type ChatTransfer, previewPreferences, resetChatWindow } from "../fixtures/chat-window"
import { client, useApp, useSession } from "../fixtures/client"
import { useExtensions } from "../fixtures/extensions"
import { navigatePreview, providers } from "../fixtures/native"
import { pluginEntry } from "../fixtures/plugins"
import type { PreviewState } from "../fixtures/prepare"

export interface ProductPreviewProps extends PreviewState {
  page?:
    | "chat"
    | "plugins"
    | "pluginDetail"
    | "archives"
    | "extensions"
    | "extension"
    | "settings"
    | "guide"
    | "gamepad"
    | "vibemon"
    | "login"
    | "floating"
    | "petWindow"
    | "petBubble"
  settingsSection?: string
  paletteOpen?: boolean
  hotkeysOpen?: boolean
  height?: number
  width?: number
}

function OpenFixtureFile({ file }: { file?: string | null }) {
  const workspace = useWorkspace()
  useEffect(() => {
    if (file && workspace)
      void workspace
        .openFile(`${PROJECT_DIRECTORY}/${file}`, PROJECT_DIRECTORY)
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
  }, [file, workspace?.openFile])
  return null
}

export function ProductPreview({
  page: initialPage = "chat",
  chatCase = "welcome",
  settingsSection = "general",
  extensionId = "unavailable",
  sidebarPinned = true,
  paletteOpen: initialPalette = false,
  hotkeysOpen: initialHotkeys = false,
  file,
  width,
  height
}: ProductPreviewProps) {
  const { t } = useTranslation()
  const { host: extensions, state: extensionState } = useExtensions()
  const reportError = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error))
  const openExtension = (id: string) => {
    setSurfaceId(id)
    setPage("extension")
  }
  const actions = useApp((state) => state.actions)
  const globalActions = actions.filter((action) => action.sessionId === null)
  const globalForms = globalActions.filter(
    (action): action is FormAction => action.kind === "elicitation" && isFormElicitation(action.params)
  )
  const actionCards = globalActions
    .filter((action) => !globalForms.some((form) => form.id === action.id))
    .map((action) => <ActionCard key={action.id} action={action} />)
  const [page, setPage] = useState(initialPage)
  const [surfaceId, setSurfaceId] = useState(extensionId)
  const [paletteOpen, setPaletteOpen] = useState(initialPalette)
  const [hotkeysOpen, setHotkeysOpen] = useState(initialHotkeys)
  const [selectedId, setSelectedId] = useState<string | null>(
    chatCase === "welcome" || chatCase === "project" ? null : chatCase
  )
  const [cwd, setCwd] = useState<string | null>(chatCase === "welcome" ? null : PROJECT_DIRECTORY)
  const [generation, setGeneration] = useState(0)
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null)
  const [driveTarget, setDriveTarget] = useState<HTMLDivElement | null>(null)
  const session = useSession(selectedId)
  const drafts = useApp((state) => state.draftSessions)
  const connection = useApp((state) => state.connection)
  const error = useApp((state) => state.connectionError)
  const leading = ["plugins", "pluginDetail", "extensions", "archives", "extension", "vibemon"].includes(page)
  const leadingPage =
    page === "archives"
      ? "archives"
      : page === "vibemon"
        ? "vibemon"
        : page === "extensions" || page === "extension"
          ? "extensions"
          : "plugins"
  useEffect(() => {
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<{ page: ProductPreviewProps["page"]; section?: string }>).detail
      if (detail.section) {
        const url = new URL(window.location.href)
        url.searchParams.set("tab", detail.section)
        history.replaceState(null, "", url)
      }
      setPage(detail.page ?? "chat")
    }
    const transfer = (event: Event) => {
      const value = (event as CustomEvent<ChatTransfer>).detail
      setSelectedId(value.sessionId)
      setCwd(value.cwd)
    }
    window.addEventListener("storybook:navigate", navigate)
    window.addEventListener("storybook:transfer", transfer)
    return () => {
      window.removeEventListener("storybook:navigate", navigate)
      window.removeEventListener("storybook:transfer", transfer)
    }
  }, [])
  useEffect(() => {
    if (initialPage !== "settings") return
    const url = new URL(window.location.href)
    url.searchParams.set("tab", settingsSection)
    history.replaceState(null, "", url)
  }, [initialPage, settingsSection])
  const select = (thread: SessionSummary) => {
    void (async () => {
      if (thread.archived) await client.unarchive(thread.sessionId)
      await client.open(thread.sessionId, thread.cwd)
      setCwd(thread.cwd)
      setSelectedId(thread.sessionId)
      setPage("chat")
    })()
  }
  const newChat = (directory: string | null = cwd) => {
    void client.discardDraft("main")
    setCwd(directory)
    setSelectedId(null)
    setGeneration((value) => value + 1)
    setPage("chat")
  }
  const projectMenu = (
    <ChatProjectMenu
      cwd={session?.cwd ?? cwd}
      currentSessionId={selectedId}
      onSelect={select}
      onNewChat={() => newChat()}
    />
  )
  const moveToWindow = () => {
    void exportDraft(selectedId ?? DRAFT_SESSION_ID)
      .then((draft) => {
        resetChatWindow(selectedId, session?.cwd ?? cwd, draft)
        setPage("floating")
      })
      .catch((error: unknown) => toast.error(String(error)))
  }
  const chat =
    session !== null && !drafts[session.id] ? (
      <ChatView
        key={session.id}
        session={session}
        projectMenu={projectMenu}
        onSelectSession={select}
        onOpenWindow={moveToWindow}
        onReturnToMain={page === "floating" ? () => setPage("chat") : undefined}
        onNewChat={() => newChat()}
        onDeleted={() => newChat()}
      />
    ) : (
      <>
        {(connection === "failed" || connection === "disconnected") && (
          <div className="mx-auto w-full max-w-3xl px-6 pt-12">
            <Alert variant="destructive">
              <AlertTitle>{t(connection === "failed" ? "connection.failed" : "connection.disconnected")}</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-2">
                {error !== null && <span className="font-mono">{error}</span>}
                <Button size="sm" variant="outline" onClick={() => void client.connect()}>
                  {t("connection.reconnect")}
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        )}
        <DraftChat
          key={generation}
          owner="main"
          cwd={cwd}
          providerSnapshot={providers}
          projectMenu={projectMenu}
          onCreated={setSelectedId}
          onCwdChange={setCwd}
          onSendingChange={() => {}}
          onAuthRequired={() => navigatePreview("settings", "provider")}
          onNewChat={() => newChat()}
          onOpenWindow={moveToWindow}
        />
      </>
    )
  const fullPage =
    page === "petWindow" ? (
      <PetWindow />
    ) : page === "petBubble" ? (
      <PetQuickReply />
    ) : page === "settings" ? (
      <SettingsPage key={settingsSection} />
    ) : page === "guide" ? (
      <GuidePage />
    ) : page === "gamepad" ? (
      <GamepadWindow />
    ) : page === "login" ? (
      <AuthGate>
        <ProductPreview page="chat" />
      </AuthGate>
    ) : page === "floating" ? (
      <ChatWindow preferences={previewPreferences} />
    ) : null
  return (
    <div
      className={`h-dvh overflow-hidden ${page === "petWindow" || page === "petBubble" ? "bg-transparent" : "bg-sidebar"}`}
      style={{ ...(width ? { width, maxWidth: "100vw" } : {}), ...(height ? { height } : {}) }}
    >
      {fullPage ?? (
        <WindowsMainWindowShell>
          <WallpaperBackground onError={reportError}>
            <MainSidebarLayout
              initialPinned={sidebarPinned}
              screen={leading ? "leading" : "main"}
              onScreenChange={(screen) => setPage(screen === "main" ? "chat" : "plugins")}
              toolbar={<div ref={setToolbar} className="flex flex-1 items-center" />}
              statusBar={
                <>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <ExtensionStatusBar
                        views={extensions.views}
                        renderView={(view) => <ExtensionMount id={view.id} />}
                      />
                    </div>
                    <DriveStatus />
                  </div>
                  <div className="flex size-8 items-center justify-center">
                    <ClientVersionPopover />
                  </div>
                </>
              }
              sidebar={
                <SessionSidebar
                  screen={leading ? "leading" : "main"}
                  leadingPage={leadingPage}
                  selectedId={selectedId}
                  onSelect={select}
                  onNewChat={() => newChat()}
                  onNewProjectChat={newChat}
                  onSearch={() => setPaletteOpen(true)}
                  onOpenWindow={moveToWindow}
                  onOpenSettings={() => setPage("settings")}
                  onOpenVibemon={() => setPage("vibemon")}
                  onOpenPlugins={() => setPage("plugins")}
                  extensionNavigation={
                    <ExtensionNavigation
                      host={extensions}
                      manifests={extensionState.native?.installations.map((item) => item.manifest) ?? []}
                      activeView={surfaceId}
                      onOpenSurface={openExtension}
                      onError={reportError}
                    />
                  }
                  drivePanel={<div ref={setDriveTarget} className="min-h-0 flex-1 overflow-auto" />}
                  onSwitchScreen={() => setPage(leading ? "chat" : "plugins")}
                />
              }
              leading={
                <>
                  <LeadingNavigation
                    activePage={leadingPage}
                    onOpenVibemon={() => setPage("vibemon")}
                    onOpenPlugins={() => setPage("plugins")}
                    onOpenArchives={() => setPage("archives")}
                  >
                    <ExtensionNavigation
                      host={extensions}
                      manifests={extensionState.native?.installations.map((item) => item.manifest) ?? []}
                      activeView={surfaceId}
                      onOpenSurface={openExtension}
                      onError={reportError}
                    />
                  </LeadingNavigation>
                  <SidebarInset className="main-chat-surface flex min-h-0 flex-col">
                    {leading && actionCards.length > 0 && (
                      <div className="mx-auto w-full max-w-3xl px-6 pt-12">{actionCards}</div>
                    )}
                    {page === "plugins" && <PluginsPage cwd={cwd} active />}
                    {page === "pluginDetail" && (
                      <>
                        <PluginIconDefinitions />
                        <PluginDetailPage entry={pluginEntry(2)} onBack={() => setPage("plugins")} />
                      </>
                    )}
                    {page === "archives" && <ArchivedChatsPage />}
                    {page === "extensions" && (
                      <div className="mx-auto w-full max-w-5xl overflow-auto px-6 pt-8 pb-6">
                        <ExtensionsSection
                          onOpenSurface={(id) => {
                            setSurfaceId(id)
                            setPage("extension")
                          }}
                        />
                      </div>
                    )}
                    {page === "extension" && <ExtensionPage id={surfaceId} onClose={() => setPage("extensions")} />}
                    {page === "vibemon" && <VibemonCenter />}
                  </SidebarInset>
                </>
              }
              main={
                <SidebarInset className="main-chat-surface main-workspace-surface flex min-h-0 flex-col">
                  <WorkspaceHeaderContext value={toolbar}>
                    <FileWorkspace cwd={session?.cwd ?? cwd}>
                      <OpenFixtureFile file={file} />
                      {!leading && actionCards.length > 0 && (
                        <div className="mx-auto w-full max-w-3xl px-6 pt-12">{actionCards}</div>
                      )}
                      <div className="flex min-h-0 flex-1 flex-col">{chat}</div>
                      {driveTarget &&
                        createPortal(
                          <DrivePage currentProject={cwd} onOpenProject={async (root) => newChat(root.localPath)} />,
                          driveTarget
                        )}
                    </FileWorkspace>
                  </WorkspaceHeaderContext>
                </SidebarInset>
              }
            >
              <CommandPalette
                open={paletteOpen}
                onOpenChange={setPaletteOpen}
                onNewChat={() => newChat()}
                onOpenSettings={() => setPage("settings")}
                onOpenPlugins={() => setPage("plugins")}
                onOpenHotkeys={() => setHotkeysOpen(true)}
                onOpenExtension={(id) => {
                  setSurfaceId(id)
                  setPage("extension")
                }}
                onSelect={select}
              />
              {globalForms[0] && (
                <ElicitationFormDialog key={globalForms[0].id} action={globalForms[0]} total={globalForms.length} />
              )}
              <HotkeysDialog open={hotkeysOpen} onOpenChange={setHotkeysOpen} />
            </MainSidebarLayout>
          </WallpaperBackground>
        </WindowsMainWindowShell>
      )}
      {!["petWindow", "petBubble", "login"].includes(page) && <ZoomFeedback />}
      <DriveDeleteConfirmation />
      <Toaster duration={Infinity} />
    </div>
  )
}
