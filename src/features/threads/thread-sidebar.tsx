/**
 * ThreadSidebar — ALwith Desktop's `SessionsPanel` reduced for Codex threads: Codex's own
 * thread list grouped by project (real cwd), newest first. Group and row geometry are
 * Desktop's navigation primitives (`NavigationGroup` / `NavigationSessionItem`); row
 * actions live in the hover card, the row's trailing slot only ever shows the stop button.
 */

import { ScrollArea } from "@base-ui/react/scroll-area"
import {
  ActivityIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BlocksIcon,
  CloudIcon,
  FolderClosedIcon,
  FolderIcon,
  FolderOpenIcon,
  GitForkIcon,
  MessagesSquareIcon,
  PawPrintIcon,
  PencilIcon,
  PictureInPicture2Icon,
  PlusIcon,
  PuzzleIcon,
  SearchIcon,
  Trash2Icon
} from "lucide-react"
import { motion } from "motion/react"
import type { ReactNode } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { ThreadSummary } from "@/agent/client"
import { hasRename } from "@/agent/codex-extensions"
import { HoverInfoAction } from "@/components/alwith-ui/hover-info-card"
import { GuideButton } from "@/features/guide/guide-button"
import { NavigationMenuIconButton } from "@/components/alwith-ui/navigation-menu-icon-button"
import { Pane } from "@/components/alwith-ui/pane"
import { RowStopButton } from "@/components/alwith-ui/row-more-menu"
import { useSidebarOverlay } from "@/components/alwith-ui/sidebar-overlay-context"
import { MENU_HIGHLIGHT } from "@/components/alwith-ui/surface-highlight"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ProjectSessionPopover } from "@/features/chat/project-session-popover"
import { DriveArchiveAction } from "@/features/drive/archive-action"
import { useDriveVisible } from "@/features/drive/use-drive-visible"
import type { MainScreen } from "@/features/layout/components/main-sidebar-layout"
import { NavigationGroup } from "@/features/layout/components/navigation/navigation-group"
import { NavigationItemButton } from "@/features/layout/components/navigation/navigation-item"
import { NavigationLeading } from "@/features/layout/components/navigation/navigation-leading"
import { NavigationSessionItem } from "@/features/layout/components/navigation/navigation-session-item"
import { NavigationStack } from "@/features/layout/components/navigation/navigation-stack"
import { UpdateStatusButton } from "@/features/updater/components/update-status-button"
import { client, stopSession, useApp } from "@/lib/client"
import { basename } from "@/lib/path"
import { isMac } from "@/lib/platform"
import type { RunState } from "@/lib/run-state"
import { displayShortcut } from "@/lib/shortcut-formatter"
import { cn } from "@/lib/utils"
import { ActivityPanel } from "./activity-panel"
import { SidebarAccountMenu } from "./sidebar-account-menu"
import { type SidebarView, useThreadsUiStore } from "./store"
import { groupThreads, QUICK_CHATS_GROUP, REVEAL_PAGE_SIZE } from "./thread-groups"
import { relativeTime, ThreadInfoCard } from "./thread-info-card"
import { VirtualThreadRows } from "./virtual-thread-rows"

function report(promise: Promise<unknown>) {
  return promise.then(
    () => {},
    (error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  )
}

/** Desktop's `DiskSessionRow`: state dot, title, time in the meta slot, stop button while alive. */
function ThreadRow({
  thread,
  active,
  state,
  onSelect,
  onForked,
  onDelete,
  onHoverCardOpenChange
}: {
  thread: ThreadSummary
  active: boolean
  state?: RunState
  onSelect: () => void
  onForked: (thread: ThreadSummary) => void
  onDelete: () => void
  onHoverCardOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const title = thread.title ?? t("sidebar.untitled")
  return (
    <NavigationSessionItem
      data-session-id={thread.sessionId}
      role="button"
      tabIndex={0}
      active={active}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect()
        }
      }}
      state={state}
      title={title}
      onHoverCardOpenChange={onHoverCardOpenChange}
      hoverCard={<ThreadHoverBody thread={thread} onDelete={onDelete} onForked={onForked} />}
      meta={
        thread.updatedAt !== null ? (
          <span className="text-muted-foreground shrink-0 text-xs">
            {relativeTime(thread.updatedAt, i18n.language)}
          </span>
        ) : undefined
      }
      actions={
        state != null ? (
          <RowStopButton title={t("sidebar.stop")} onStop={() => report(stopSession(thread.sessionId))} />
        ) : undefined
      }
    />
  )
}

/** Desktop's `SessionHoverBody`: info card plus the row actions (rename / fork / archive / delete). */
function ThreadHoverBody({
  thread,
  onDelete,
  onForked
}: {
  thread: ThreadSummary
  onDelete: () => void
  onForked: (thread: ThreadSummary) => void
}) {
  const { t } = useTranslation()
  const canRename = useApp(state => hasRename(state.agent))
  const [renaming, setRenaming] = useState(false)
  const [forking, setForking] = useState(false)
  const submitting = useRef(false)
  const canFork = useApp(state => state.connection === "ready" && state.agent?.capabilities?.session?.fork != null)
  return (
    <ThreadInfoCard
      thread={thread}
      renaming={renaming}
      onRename={name => {
        setRenaming(false)
        if (name !== null) report(client.renameSession(thread.sessionId, name))
      }}
      actions={
        <>
          {canRename && (
            <HoverInfoAction icon={<PencilIcon />} label={t("sidebar.rename")} onClick={() => setRenaming(true)} />
          )}
          <DriveArchiveAction sessionId={thread.sessionId} />
          {thread.archived ? (
            <HoverInfoAction
              icon={<ArchiveRestoreIcon />}
              label={t("sidebar.unarchive")}
              onClick={() => report(client.unarchive(thread.sessionId))}
            />
          ) : (
            <>
              <HoverInfoAction
                icon={<GitForkIcon />}
                label={t("sidebar.fork")}
                disabled={!canFork || forking}
                onClick={() => {
                  if (submitting.current) return
                  submitting.current = true
                  setForking(true)
                  report(
                    client
                      .fork(thread.sessionId, thread.cwd)
                      .then(id => {
                        const forked = client.state.threads.find(item => item.sessionId === id)
                        if (!forked) throw new Error("Forked chat is missing from the session list")
                        onForked(forked)
                      })
                      .finally(() => {
                        submitting.current = false
                        setForking(false)
                      })
                  )
                }}
              />
              <HoverInfoAction
                icon={<ArchiveIcon />}
                label={t("sidebar.archive")}
                onClick={() => report(client.archive(thread.sessionId))}
              />
            </>
          )}
          <HoverInfoAction variant="destructive" icon={<Trash2Icon />} label={t("sidebar.delete")} onClick={onDelete} />
        </>
      }
    />
  )
}

export function ThreadSidebar({
  screen,
  leadingPage,
  selectedId,
  onSelect,
  onNewChat,
  onNewProjectChat,
  onSearch,
  onOpenWindow,
  onOpenVibemon,
  onOpenSettings,
  onOpenPlugins,
  onOpenExtensions,
  extensionNavigation,
  drivePanel,
  onSwitchScreen
}: {
  screen: MainScreen
  leadingPage: "plugins" | "extensions" | "vibemon"
  selectedId: string | null
  onSelect: (thread: ThreadSummary) => void
  onNewChat: () => void
  onNewProjectChat: (cwd: string) => void
  onSearch: () => void
  onOpenWindow: () => void
  onOpenVibemon?: () => void
  onOpenSettings: () => void
  onOpenPlugins: () => void
  extensionNavigation?: ReactNode
  drivePanel?: ReactNode
  onOpenExtensions: () => void
  onSwitchScreen: () => void
}) {
  const { t } = useTranslation()
  const threads = useApp(state => state.threads)
  const threadsLoaded = useApp(state => state.threadsLoaded)
  const threadsError = useApp(state => state.threadsError)
  const connection = useApp(state => state.connection)
  const connectionError = useApp(state => state.connectionError)
  const archived = useApp(state => state.archivedThreads)
  const archivedLoaded = useApp(state => state.archivedLoaded)
  const archivedCursor = useApp(state => state.archivedCursor)
  const runStates = useApp(state => state.runStates)
  // Keep expansion state in the shared in-memory store, as in Desktop; preserve it while the app runs and reset it on restart.
  const windowsTempDirectory = useThreadsUiStore(s => s.windowsTempDirectory)
  const revealed = useThreadsUiStore(s => s.revealed)
  const reveal = useThreadsUiStore(s => s.reveal)
  const projectOpen = useThreadsUiStore(s => s.projectOpen)
  const setProjectOpen = useThreadsUiStore(s => s.setProjectOpen)
  // Sidebar panel (Desktop's activeNavigationItem): session list or activity.
  const view = useThreadsUiStore(s => s.view)
  const setView = useThreadsUiStore(s => s.setView)
  // Tabs share the navigation icon buttons' 30px row height and hover styles, without an outer background panel.
  // Selected: icon and text inside a pill; unselected: icon only (Desktop's atlas-layout tabs, reduced to two items).
  const driveVisible = useDriveVisible()
  const [driveVisited, setDriveVisited] = useState(false)
  useEffect(() => {
    if (!driveVisible && view === "drive") setView("sessions")
    if (!driveVisible) setDriveVisited(false)
    else if (view === "drive") setDriveVisited(true)
  }, [driveVisible, view, setView])
  const tabs: { key: SidebarView; title: string; icon: React.ReactNode }[] = [
    { key: "sessions", title: t("sidebar.chats"), icon: <FolderIcon /> },
    { key: "activity", title: t("sidebar.activity"), icon: <ActivityIcon /> },
    { key: "drive", title: t("settings.drive"), icon: <CloudIcon /> }
  ]
  const [pendingDelete, setPendingDelete] = useState<ThreadSummary | null>(null)
  useSidebarOverlay(pendingDelete !== null)
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [archivedLimit, setArchivedLimit] = useState(REVEAL_PAGE_SIZE)
  const [archivedOpen, setArchivedOpen] = useState(false)

  const groups = useMemo(
    () => (threadsLoaded ? groupThreads(threads, windowsTempDirectory) : []),
    [threadsLoaded, threads, windowsTempDirectory]
  )

  const stateOf = (thread: ThreadSummary): RunState | undefined => runStates[thread.sessionId]?.state

  const renderRow = (thread: ThreadSummary, onHoverCardOpenChange: (open: boolean) => void) => (
    <ThreadRow
      key={thread.sessionId}
      onHoverCardOpenChange={onHoverCardOpenChange}
      thread={thread}
      active={thread.sessionId === selectedId}
      state={stateOf(thread)}
      onSelect={() => onSelect(thread)}
      onForked={onSelect}
      onDelete={() => setPendingDelete(thread)}
    />
  )

  return (
    <Sidebar collapsible="none" className="h-full min-h-0 shrink-0 bg-transparent [--navigation-row-height:30px]">
      <SidebarHeader className={cn("shrink-0", isMac() && "pt-9")} data-tauri-drag-region>
        <div className="flex items-center gap-0.5 px-1" data-tauri-drag-region>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold" data-tauri-drag-region>
            {t("app.name")}
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label={t("sidebar.search")} onClick={onSearch}>
                  <SearchIcon />
                </Button>
              }
            />
            <TooltipContent>
              {t("sidebar.search")} {displayShortcut("CmdOrCtrl+K")}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label={t("chatWindow.open")} onClick={onOpenWindow}>
                  <PictureInPicture2Icon />
                </Button>
              }
            />
            <TooltipContent>{t("chatWindow.open")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label={t("sidebar.newChat")} onClick={onNewChat}>
                  <PlusIcon />
                </Button>
              }
            />
            <TooltipContent>
              {t("sidebar.newChat")} {displayShortcut("CmdOrCtrl+N")}
            </TooltipContent>
          </Tooltip>
        </div>
        <NavigationItemButton
          active={screen === "leading" && leadingPage === "plugins"}
          className={`${MENU_HIGHLIGHT} gap-2 px-2`}
          onClick={onOpenPlugins}>
          <PuzzleIcon />
          <span>{t("sidebar.plugins")}</span>
        </NavigationItemButton>
        <NavigationItemButton
          active={screen === "leading" && leadingPage === "extensions"}
          className={`${MENU_HIGHLIGHT} gap-2 px-2`}
          onClick={onOpenExtensions}>
          <BlocksIcon />
          <span>{t("sidebar.extensions")}</span>
        </NavigationItemButton>
        {onOpenVibemon && (
          <NavigationItemButton
            active={screen === "leading" && leadingPage === "vibemon"}
            className={`${MENU_HIGHLIGHT} gap-2 px-2`}
            onClick={onOpenVibemon}>
            <PawPrintIcon />
            <span>Vibemon</span>
          </NavigationItemButton>
        )}
        {extensionNavigation}
      </SidebarHeader>
      <SidebarContent className="gap-0 overflow-hidden">
        <div className="relative mx-2 flex h-[30px] shrink-0 items-center gap-0.5 [--navigation-row-height:30px]">
          <div
            role="tablist"
            className={`${MENU_HIGHLIGHT} bg-foreground/5 flex h-[30px] w-full flex-none items-center gap-0.5 rounded-[10px] [corner-shape:superellipse(1.5)]`}>
            {tabs
              .filter(tab => tab.key !== "drive" || driveVisible)
              .map(tab => {
                const active = view === tab.key
                return (
                  <NavigationMenuIconButton
                    key={tab.key}
                    role="tab"
                    active={active}
                    expanded={active}
                    highlight={false}
                    aria-selected={active}
                    title={tab.title}
                    onClick={() => setView(tab.key)}
                    className={cn(
                      "relative isolate h-[30px] min-w-[30px] justify-start rounded-[10px] px-[6px] text-sm [corner-shape:superellipse(1.5)] [&_svg]:relative [&_svg]:z-10 [&_svg]:size-[18px]",
                      active ? "grow transition-[flex-grow] duration-200 ease-out" : "grow-0 duration-0"
                    )}>
                    {active && (
                      <motion.span
                        layoutId="navigation-selected-pill"
                        aria-hidden="true"
                        className="bg-foreground/8 pointer-events-none absolute inset-0 -z-10 rounded-[10px] [corner-shape:superellipse(1.5)]"
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      />
                    )}
                    {tab.icon}
                    <span
                      className={cn(
                        "relative z-10 grid",
                        active
                          ? "ms-1.5 grid-cols-[1fr] transition-[grid-template-columns,margin-inline-start] duration-200 ease-out"
                          : "ms-0 grid-cols-[0fr] duration-0"
                      )}>
                      <span className="min-w-0 overflow-hidden whitespace-nowrap">{tab.title}</span>
                    </span>
                  </NavigationMenuIconButton>
                )
              })}
          </div>
        </div>
        {driveVisible && (driveVisited || view === "drive") && (
          <div
            hidden={view !== "drive"}
            className={cn("min-h-0 flex-1 flex-col", view === "drive" ? "flex" : "hidden")}>
            {drivePanel}
          </div>
        )}
        {view === "drive" ? null : view === "activity" ? (
          <ActivityPanel selectedId={selectedId} onSelect={onSelect} />
        ) : (
          <Pane viewportRef={setViewport} viewportClassName="px-1 py-1">
            {/* Observe content height as groups expand, collapse or reveal more rows. */}
            <ScrollArea.Content render={<NavigationStack />} style={{ minWidth: 0 }}>
              {!threadsLoaded &&
                threadsError === null &&
                connection !== "failed" &&
                (connection !== "disconnected" || connectionError === null) && (
                  <div aria-busy="true" className="flex flex-col gap-0.5">
                    {(["w-24", "w-32"] as const).map(width => (
                      <div
                        key={width}
                        data-slot="project-skeleton-row"
                        className="relative flex h-[var(--navigation-row-height)] w-full items-center gap-1 rounded-[10px] ps-1 pe-1.5 [corner-shape:superellipse(1.5)]">
                        <NavigationLeading>
                          <FolderClosedIcon className="text-foreground/40 size-3.5" />
                        </NavigationLeading>
                        <Skeleton className={cn("bg-foreground/12 h-3 rounded-sm", width)} />
                        <Skeleton className="bg-foreground/12 ms-auto h-2.5 w-4 rounded-sm" />
                      </div>
                    ))}
                  </div>
                )}
              {threadsError !== null && (
                <div role="alert" className="text-muted-foreground flex flex-col items-start gap-2 px-3 py-4 text-sm">
                  <span>{threadsError}</span>
                  <Button variant="outline" size="sm" onClick={() => report(client.listThreads({ reset: true }))}>
                    {t("actions.retry")}
                  </Button>
                </div>
              )}
              {groups.map(([cwd, list]) => {
                const isOpen = projectOpen.get(cwd) ?? false
                const quick = cwd === QUICK_CHATS_GROUP
                const limit = revealed.get(cwd) ?? REVEAL_PAGE_SIZE
                return (
                  // Two levels: collapsible project groups, then their sessions. Expansion is controlled by the shared store.
                  <NavigationGroup
                    key={cwd}
                    wrapHeader={
                      quick
                        ? undefined
                        : header => (
                            <ProjectSessionPopover
                              cwd={cwd}
                              trigger={header}
                              onSelect={onSelect}
                              onNewChat={() => onNewProjectChat(cwd)}
                            />
                          )
                    }
                    open={isOpen}
                    onOpenChange={open => setProjectOpen(new Map(projectOpen).set(cwd, open))}
                    leading={
                      // Project (workspace) groups use an open folder icon when expanded and a closed folder icon when collapsed.
                      quick ? (
                        <MessagesSquareIcon className="text-foreground size-3.5 shrink-0" />
                      ) : isOpen ? (
                        <FolderOpenIcon className="text-foreground size-3.5 shrink-0" />
                      ) : (
                        <FolderClosedIcon className="text-foreground size-3.5 shrink-0" />
                      )
                    }
                    label={quick ? t("sidebar.quickChats") : basename(cwd)}
                    count={list.length}>
                    <VirtualThreadRows threads={list.slice(0, limit)} viewport={viewport} renderRow={renderRow} />
                    {list.length > limit && (
                      <NavigationItemButton
                        className={`${MENU_HIGHLIGHT} text-muted-foreground`}
                        onClick={() => reveal(cwd, limit + REVEAL_PAGE_SIZE)}>
                        {t("sidebar.loadMore")}
                      </NavigationItemButton>
                    )}
                  </NavigationGroup>
                )
              })}
              <NavigationGroup
                open={archivedOpen}
                onOpenChange={open => {
                  setArchivedOpen(open)
                  if (open && !archivedLoaded) report(client.listThreads({ archived: true }))
                }}
                leading={<ArchiveIcon className="text-foreground size-3.5 shrink-0" />}
                label={t("sidebar.archived")}
                count={archivedLoaded ? archived.length : undefined}>
                <VirtualThreadRows
                  threads={archived.slice(0, archivedLimit)}
                  viewport={viewport}
                  renderRow={renderRow}
                />
                {(archived.length > archivedLimit || archivedCursor !== null) && (
                  <NavigationItemButton
                    className={`${MENU_HIGHLIGHT} text-muted-foreground`}
                    onClick={() => {
                      if (archived.length > archivedLimit) setArchivedLimit(value => value + REVEAL_PAGE_SIZE)
                      else
                        report(
                          client
                            .listThreads({ archived: true })
                            .then(() => setArchivedLimit(value => value + REVEAL_PAGE_SIZE))
                        )
                    }}>
                    {t("sidebar.loadMore")}
                  </NavigationItemButton>
                )}
              </NavigationGroup>
            </ScrollArea.Content>
          </Pane>
        )}
      </SidebarContent>
      <SidebarFooter className="shrink-0 pb-[var(--main-surface-block-gutter)]">
        <Button
          variant="ghost"
          className={cn(
            "hover:bg-foreground/5 h-10 w-full rounded-lg px-2",
            screen === "main" ? "justify-start" : "justify-end"
          )}
          aria-label={t(screen === "main" ? "sidebar.openLeading" : "sidebar.backToMain")}
          title={t(screen === "main" ? "sidebar.openLeading" : "sidebar.backToMain")}
          onClick={onSwitchScreen}>
          {screen === "main" ? <ArrowLeftIcon /> : <ArrowRightIcon />}
        </Button>
        <UpdateStatusButton />
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <SidebarAccountMenu onOpenSettings={onOpenSettings} />
          </div>
          <GuideButton />
        </div>
      </SidebarFooter>
      <Dialog open={pendingDelete !== null} onOpenChange={open => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sidebar.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("sidebar.deleteDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              {t("actions.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (pendingDelete) report(client.delete(pendingDelete.sessionId))
                setPendingDelete(null)
              }}>
              {t("sidebar.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sidebar>
  )
}
