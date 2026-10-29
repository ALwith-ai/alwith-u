/**
 * SessionSidebar — U's sidebar: header navigation, the Collections / Chats / Activity / Drive tabs
 * and the account footer. The Chats tab is `@alwith/module-chat`'s SessionList; its rows carry U's
 * collection and drive actions in their hover cards.
 */

import {
  HoverInfoAction,
  MENU_HIGHLIGHT,
  NavigationItemButton,
  NavigationStack,
  SessionList,
  type SessionListExpansion,
  SessionRow
} from "@alwith/module-chat/session-list"
import { ScrollArea } from "@base-ui/react/scroll-area"
import {
  ActivityIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CloudIcon,
  FolderIcon,
  FolderMinusIcon,
  LayoutGridIcon,
  PawPrintIcon,
  PictureInPicture2Icon,
  PlusIcon,
  SearchIcon,
  StarIcon
} from "lucide-react"
import { motion } from "motion/react"
import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import type { SessionSummary } from "@/agent/client"
import { NavigationMenuIconButton } from "@/components/alwith-ui/navigation-menu-icon-button"
import { Pane } from "@/components/alwith-ui/pane"
import { ShortcutHint } from "@/components/alwith-ui/shortcut-hint"
import { Button } from "@/components/ui/button"
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ProjectSessionPopover } from "@/features/chat/project-session-popover"
import { AddToCollectionAction } from "@/features/collection/collection-menu"
import { CollectionPanel } from "@/features/collection/collection-panel"
import { dispatchCollection, reportCollection } from "@/features/collection/store"
import { DriveArchiveAction } from "@/features/drive/archive-action"
import { useDriveVisible } from "@/features/drive/use-drive-visible"
import { GuideButton } from "@/features/guide/guide-button"
import type { MainScreen } from "@/features/layout/components/main-sidebar-layout"
import { NavigationAds } from "@/features/layout/components/navigation-ads"
import { UpdateStatusButton } from "@/features/updater/components/update-status-button"
import { useApp } from "@/lib/client"
import { useChatWindowShortcut } from "@/lib/use-chat-window-shortcut"
import { cn } from "@/lib/utils"

import { ActivityPanel } from "./activity-panel"
import { SessionListHostProvider } from "./session-list-host"
import { SidebarAccountMenu } from "./sidebar-account-menu"
import { type SidebarView, useSessionsUiStore } from "./store"

/** U's own hover-card actions on a session row: collections, then drive. */
function SessionRowActions({ sessionRow, collectionId }: { sessionRow: SessionSummary; collectionId?: string }) {
  const { t } = useTranslation()
  return (
    <>
      <AddToCollectionAction sessionId={sessionRow.sessionId} allowRemove={collectionId === undefined} />
      {collectionId !== undefined && (
        <HoverInfoAction
          icon={<FolderMinusIcon />}
          label={t("collection.removeFromGroup")}
          onClick={() =>
            reportCollection(dispatchCollection({ type: "remove", collectionId, sessionId: sessionRow.sessionId }))
          }
        />
      )}
      <DriveArchiveAction sessionId={sessionRow.sessionId} />
    </>
  )
}

type SessionSidebarProps = {
  screen: MainScreen
  leadingPage: "plugins" | "extensions" | "vibemon" | "archives"
  selectedId: string | null
  onSelect: (sessionRow: SessionSummary) => void
  onNewChat: () => void
  onNewProjectChat: (cwd: string | null, collectionId?: string) => void
  onSearch: () => void
  onOpenWindow: () => void
  onOpenVibemon?: () => void
  onOpenSettings: () => void
  onOpenPlugins: () => void
  extensionNavigation?: ReactNode
  drivePanel?: ReactNode
  onSwitchScreen: () => void
}

export function SessionSidebar(props: SessionSidebarProps) {
  return (
    <SessionListHostProvider>
      <SidebarPanels {...props} />
    </SessionListHostProvider>
  )
}

function SidebarPanels({
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
  extensionNavigation,
  drivePanel,
  onSwitchScreen
}: SessionSidebarProps) {
  const { t } = useTranslation()
  const runStates = useApp((state) => state.runStates)
  // Keep expansion state in the shared in-memory store, as in Desktop; preserve it while the app runs and reset it on restart.
  const revealed = useSessionsUiStore((s) => s.revealed)
  const reveal = useSessionsUiStore((s) => s.reveal)
  const projectOpen = useSessionsUiStore((s) => s.projectOpen)
  const setProjectOpen = useSessionsUiStore((s) => s.setProjectOpen)
  // Sidebar panel (Desktop's activeNavigationItem): session list or activity.
  const view = useSessionsUiStore((s) => s.view)
  const setView = useSessionsUiStore((s) => s.setView)
  const activitySeen = useSessionsUiStore((s) => s.activitySeen)
  const setActivitySeen = useSessionsUiStore((s) => s.setActivitySeen)
  const draftSessions = useApp((state) => state.draftSessions)
  const activityNotifications = useMemo(
    () =>
      new Map(
        Object.values(runStates)
          .filter(
            (record) =>
              (record.state === "done" || record.state === "requires_action") &&
              (!record.reusableDraft || draftSessions[record.sessionId] !== undefined)
          )
          .map((record) => [record.sessionId, JSON.stringify([record.state, record.since, record.interruption])])
      ),
    [runStates, draftSessions]
  )
  const hasActivityNotification =
    view !== "activity" &&
    [...activityNotifications].some(([id, notification]) => activitySeen.get(id) !== notification)
  useEffect(() => {
    if (view === "activity") setActivitySeen(activityNotifications)
  }, [view, activityNotifications, setActivitySeen])
  // Tabs share the navigation icon buttons' 32px height and hover styles, without an outer background panel.
  // Selected: icon and text inside a pill; unselected: icon only (Desktop's atlas-layout tabs, reduced to two items).
  const driveVisible = useDriveVisible()
  const [driveVisited, setDriveVisited] = useState(false)
  useEffect(() => {
    if (!driveVisible && view === "drive") setView("sessions")
    if (!driveVisible) setDriveVisited(false)
    else if (view === "drive") setDriveVisited(true)
  }, [driveVisible, view, setView])
  const tabs: { key: SidebarView; title: string; icon: React.ReactNode }[] = [
    { key: "collections", title: t("collection.title"), icon: <StarIcon /> },
    { key: "sessions", title: t("sidebar.chats"), icon: <FolderIcon /> },
    { key: "activity", title: t("sidebar.activity"), icon: <ActivityIcon /> },
    { key: "drive", title: t("settings.drive"), icon: <CloudIcon /> }
  ]
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)

  const chatWindowShortcut = useChatWindowShortcut()
  const [allProjectsShown, setAllProjectsShown] = useState(false)
  const expansion: SessionListExpansion = {
    open: projectOpen,
    setOpen: (cwd, open) => setProjectOpen(new Map(projectOpen).set(cwd, open)),
    revealed,
    reveal: (cwd) => reveal(cwd, Number.POSITIVE_INFINITY),
    allProjects: allProjectsShown,
    showAllProjects: () => setAllProjectsShown(true)
  }

  const renderRow = (
    sessionRow: SessionSummary,
    onHoverCardOpenChange: (open: boolean) => void,
    collectionId?: string
  ) => (
    <SessionRow
      key={sessionRow.sessionId}
      onHoverCardOpenChange={onHoverCardOpenChange}
      sessionRow={sessionRow}
      active={sessionRow.sessionId === selectedId}
      onSelect={onSelect}
      actions={<SessionRowActions sessionRow={sessionRow} collectionId={collectionId} />}
    />
  )

  return (
    <Sidebar
      collapsible="none"
      // Keep spacing aligned with the panel's pixel gutters when WebKit clamps rem-based fonts at low zoom.
      className="h-full min-h-0 shrink-0 bg-transparent [--navigation-row-height:30px] [--spacing:4px]"
    >
      <SidebarHeader className="shrink-0 gap-1 p-1 px-2" data-tauri-drag-region>
        <div className="flex h-8 items-center gap-0.5 px-1" data-tauri-drag-region>
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
              <ShortcutHint label={t("sidebar.search")} shortcut="CmdOrCtrl+K" />
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
            <TooltipContent>
              <ShortcutHint label={t("chatWindow.open")} shortcut={chatWindowShortcut} />
            </TooltipContent>
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
              <ShortcutHint label={t("sidebar.newChat")} shortcut="CmdOrCtrl+N" />
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex flex-col gap-1">
          <NavigationItemButton
            active={screen === "leading" && (leadingPage === "plugins" || leadingPage === "extensions")}
            className={`${MENU_HIGHLIGHT} h-8 gap-2 px-2`}
            onClick={onOpenPlugins}
          >
            <LayoutGridIcon />
            <span>{t("plugins.catalog.customize")}</span>
          </NavigationItemButton>
          {onOpenVibemon && (
            <NavigationItemButton
              active={screen === "leading" && leadingPage === "vibemon"}
              className={`${MENU_HIGHLIGHT} h-8 gap-2 px-2`}
              onClick={onOpenVibemon}
            >
              <PawPrintIcon />
              <span>Vibémon</span>
            </NavigationItemButton>
          )}
        </div>
        {extensionNavigation}
      </SidebarHeader>
      <SidebarContent className="session-list-content gap-0 overflow-hidden px-0 py-1">
        <div className="relative mx-2 mb-2 flex h-8 shrink-0 items-center gap-0.5 [--navigation-row-height:32px]">
          <div
            role="tablist"
            className={`${MENU_HIGHLIGHT} flex h-8 w-full flex-none items-center gap-0.5 rounded-[10px] bg-foreground/5 [corner-shape:superellipse(1.5)]`}
          >
            {tabs
              .filter((tab) => tab.key !== "drive" || driveVisible)
              .map((tab) => {
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
                    onDoubleClick={
                      tab.key === "sessions"
                        ? () => {
                            setProjectOpen(new Map())
                            setAllProjectsShown(false)
                          }
                        : undefined
                    }
                    className={cn(
                      "relative isolate h-8 min-w-8 justify-start rounded-[10px] px-2 text-sm [corner-shape:superellipse(1.5)] [&_svg]:relative [&_svg]:z-10 [&_svg]:size-4 [&_svg]:shrink-0",
                      active ? "grow transition-[flex-grow] duration-200 ease-out" : "grow-0 duration-0"
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="navigation-selected-pill"
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 -z-10 rounded-[10px] bg-foreground/8 [corner-shape:superellipse(1.5)]"
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      />
                    )}
                    {tab.icon}
                    {tab.key === "activity" && hasActivityNotification && (
                      <span
                        data-activity-notification
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1 right-1 z-20 size-1.5 rounded-full bg-destructive motion-safe:animate-[activity-notification-pulse_2s_ease-in-out_infinite]"
                      />
                    )}
                    <span
                      className={cn(
                        "relative z-10 grid",
                        active
                          ? "ms-2 grid-cols-[1fr] transition-[grid-template-columns,margin-inline-start] duration-200 ease-out"
                          : "ms-0 grid-cols-[0fr] duration-0"
                      )}
                    >
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
            className={cn("sidebar-drive ms-2 min-h-0 flex-1 flex-col", view === "drive" ? "flex" : "hidden")}
          >
            {drivePanel}
          </div>
        )}
        {view === "drive" ? null : view === "collections" ? (
          <CollectionPanel renderRow={renderRow} onSelect={onSelect} onNewChat={(id) => onNewProjectChat(null, id)} />
        ) : view === "activity" ? (
          <ActivityPanel selectedId={selectedId} onSelect={onSelect} />
        ) : (
          <Pane className="session-list-scroll" viewportRef={setViewport} viewportClassName="ps-2 pe-0 pb-1">
            {/* Observe content height as groups expand, collapse or reveal more rows. */}
            <ScrollArea.Content render={<NavigationStack />} style={{ minWidth: 0 }}>
              <SessionList
                selectedId={selectedId}
                onSelect={onSelect}
                viewport={viewport}
                expansion={expansion}
                wrapGroupHeader={(cwd, header) => (
                  <ProjectSessionPopover
                    cwd={cwd}
                    trigger={header}
                    onSelect={onSelect}
                    onNewChat={() => onNewProjectChat(cwd)}
                  />
                )}
                rowActions={(sessionRow) => <SessionRowActions sessionRow={sessionRow} />}
              />
            </ScrollArea.Content>
          </Pane>
        )}
      </SidebarContent>
      <SidebarFooter className="shrink-0 gap-1 p-1 px-2">
        <UpdateStatusButton />
        <div className="px-1" data-slot="navigation-ads-padding">
          <NavigationAds onOpenVibemon={onOpenVibemon} />
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            className={cn(
              "h-8 min-w-0 flex-1 rounded-[10px] px-2 [corner-shape:superellipse(1.5)] hover:bg-foreground/5",
              screen === "main" ? "justify-start" : "justify-end"
            )}
            aria-label={t(screen === "main" ? "sidebar.openLeading" : "sidebar.backToMain")}
            title={t(screen === "main" ? "sidebar.openLeading" : "sidebar.backToMain")}
            onClick={onSwitchScreen}
          >
            {screen === "main" ? <ArrowLeftIcon /> : <ArrowRightIcon />}
          </Button>
        </div>
        <div className="flex h-8 items-center gap-1">
          <div className="min-w-0 flex-1">
            <SidebarAccountMenu onOpenSettings={onOpenSettings} onCreated={onNewProjectChat} />
          </div>
          <GuideButton />
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
