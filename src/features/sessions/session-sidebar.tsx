/**
 * SessionSidebar — U's sidebar: header navigation, the Collections / Chats / Activity / Drive tabs
 * and the account footer. The Chats tab is `@alwith/module-chat`'s SessionList; its rows carry U's
 * collection and drive actions in their hover cards.
 */

import {
  HoverInfoAction,
  MENU_HIGHLIGHT,
  NavigationHeader,
  NavigationItemButton,
  NavigationLeading,
  NavigationMenuIconButton,
  NavigationScreenSwitch,
  NavigationStack,
  NavigationTabs,
  SessionList,
  type SessionListExpansion,
  SessionListFilter,
  SessionRow
} from "@alwith/module-chat/session-list"
import { DesktopNavigationFooter, DesktopUpdateStatus } from "@alwith/module-desktop-shell/react"
import { ScrollArea } from "@base-ui/react/scroll-area"
import {
  ActivityIcon,
  BriefcaseIcon,
  CloudIcon,
  FolderIcon,
  FolderMinusIcon,
  PawPrintIcon,
  PictureInPicture2Icon,
  PlusIcon,
  SearchIcon,
  StarIcon
} from "lucide-react"
import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import type { SessionSummary } from "@/agent/client"
import { Pane } from "@/components/alwith-ui/pane"
import { Input } from "@/components/ui/input"
import { Sidebar, SidebarContent, SidebarHeader } from "@/components/ui/sidebar"
import { ProjectSessionPopover } from "@/features/chat/project-session-popover"
import { AddToCollectionAction, CreateCollectionMenu } from "@/features/collection/collection-menu"
import { CollectionPanel } from "@/features/collection/collection-panel"
import { dispatchCollection, reportCollection } from "@/features/collection/store"
import { DriveArchiveAction } from "@/features/drive/archive-action"
import { useDriveVisible } from "@/features/drive/use-drive-visible"
import { GuideButton } from "@/features/guide/guide-button"
import type { MainScreen } from "@/features/layout/components/main-sidebar-layout"
import { useApp } from "@/lib/client"
import { updateLabels } from "@/lib/update-labels"
import { useChatWindowShortcut } from "@/lib/use-chat-window-shortcut"
import { cn } from "@/lib/utils"

import { useActivityOrder } from "./activity-order"
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
  const driveSearchOpen = useSessionsUiStore((s) => s.driveSearchOpen)
  const setDriveSearchOpen = useSessionsUiStore((s) => s.setDriveSearchOpen)
  const [activitySearchOpen, setActivitySearchOpen] = useState(false)
  const [activityQuery, setActivityQuery] = useState("")
  const activitySeen = useSessionsUiStore((s) => s.activitySeen)
  const setActivitySeen = useSessionsUiStore((s) => s.setActivitySeen)
  const activityOrder = useActivityOrder((state) => state.ids)
  const activityNotifications = useMemo(
    () =>
      new Map(
        activityOrder
          .map((id) => runStates[id])
          .filter((record) => record !== undefined && (record.state === "done" || record.state === "requires_action"))
          .map((record) => [record.sessionId, JSON.stringify([record.state, record.since, record.interruption])])
      ),
    [runStates, activityOrder]
  )
  const hasActivityNotification =
    view !== "activity" &&
    [...activityNotifications].some(([id, notification]) => activitySeen.get(id) !== notification)
  useEffect(() => {
    if (view === "activity") setActivitySeen(activityNotifications)
  }, [view, activityNotifications, setActivitySeen])
  // Tabs share the navigation icon buttons' shared 30px height and hover styles, without an outer background panel.
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
  const collapseAll = (): void => {
    setProjectOpen(new Map())
    setAllProjectsShown(false)
  }
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
      className="h-full min-h-0 w-full shrink-0 bg-transparent [--navigation-row-height:30px] [--spacing:4px]"
    >
      <SidebarHeader className="desktop-shell-navigation-header shrink-0 gap-0.5" data-tauri-drag-region>
        <NavigationHeader
          title={<span className="ps-2">{t("app.name")}</span>}
          actions={[
            {
              key: "search",
              icon: <SearchIcon />,
              label: t("sidebar.search"),
              shortcut: "CmdOrCtrl+K",
              onClick: onSearch
            },
            {
              key: "window",
              icon: <PictureInPicture2Icon />,
              label: t("chatWindow.open"),
              shortcut: chatWindowShortcut,
              onClick: onOpenWindow
            },
            { key: "new", icon: <PlusIcon />, label: t("sidebar.newChat"), shortcut: "CmdOrCtrl+N", onClick: onNewChat }
          ]}
        >
          <NavigationItemButton
            active={screen === "leading" && (leadingPage === "plugins" || leadingPage === "extensions")}
            className={MENU_HIGHLIGHT}
            onClick={onOpenPlugins}
          >
            <NavigationLeading>
              <BriefcaseIcon />
            </NavigationLeading>
            <span>{t("plugins.catalog.customize")}</span>
          </NavigationItemButton>
          {onOpenVibemon && (
            <NavigationItemButton
              active={screen === "leading" && leadingPage === "vibemon"}
              className={MENU_HIGHLIGHT}
              onClick={onOpenVibemon}
            >
              <NavigationLeading>
                <PawPrintIcon />
              </NavigationLeading>
              <span>Vibémon</span>
            </NavigationItemButton>
          )}
        </NavigationHeader>
        {extensionNavigation}
      </SidebarHeader>
      <SidebarContent className="session-list-content gap-0 overflow-hidden px-0 py-1">
        <NavigationTabs
          className="mb-2"
          tabs={tabs.filter((tab) => tab.key !== "drive" || driveVisible)}
          view={view}
          onViewChange={(next) => setView(next as SidebarView)}
          onReset={(tab) => tab === "sessions" && collapseAll()}
          notifications={hasActivityNotification ? new Set(["activity"]) : undefined}
          trailing={
            view === "sessions" ? (
              <SessionListFilter onCollapseAll={collapseAll} />
            ) : view === "collections" ? (
              <CreateCollectionMenu />
            ) : (
              <NavigationMenuIconButton
                aria-label={t(view === "activity" ? "sidebar.searchActivity" : "sidebar.searchDrive")}
                title={t(view === "activity" ? "sidebar.searchActivity" : "sidebar.searchDrive")}
                aria-expanded={view === "activity" ? activitySearchOpen : driveSearchOpen}
                onClick={() => {
                  if (view === "drive") setDriveSearchOpen(!driveSearchOpen)
                  else {
                    setActivitySearchOpen(!activitySearchOpen)
                    setActivityQuery("")
                  }
                }}
              >
                <SearchIcon />
              </NavigationMenuIconButton>
            )
          }
        />
        {view === "activity" && activitySearchOpen && (
          <div className="px-2 pb-2">
            <Input
              autoFocus
              aria-label={t("sidebar.searchActivity")}
              placeholder={t("sidebar.searchActivity")}
              value={activityQuery}
              onChange={(event) => setActivityQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setActivitySearchOpen(false)
                  setActivityQuery("")
                }
              }}
              className="h-8"
            />
          </div>
        )}
        {driveVisible && (driveVisited || view === "drive") && (
          <div
            hidden={view !== "drive"}
            className={cn("sidebar-drive min-h-0 flex-1 flex-col", view === "drive" ? "flex" : "hidden")}
          >
            {drivePanel}
          </div>
        )}
        {view === "drive" ? null : view === "collections" ? (
          <CollectionPanel renderRow={renderRow} onSelect={onSelect} onNewChat={(id) => onNewProjectChat(null, id)} />
        ) : view === "activity" ? (
          <ActivityPanel selectedId={selectedId} onSelect={onSelect} query={activityQuery} />
        ) : (
          <Pane className="session-list-scroll" viewportRef={setViewport} viewportClassName="px-0 pb-1">
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
      <DesktopNavigationFooter
        className="flex shrink-0 flex-col gap-1 p-2"
        status={
          <DesktopUpdateStatus
            labels={updateLabels(t)}
            onError={(error) => toast.error(error instanceof Error ? error.message : String(error))}
          />
        }
      >
        <NavigationScreenSwitch screen={screen} onSwitch={onSwitchScreen} />
        <div data-sidebar-footer-row className="flex h-[var(--navigation-row-height)] items-center gap-0.5">
          <div className="min-w-0 flex-1">
            <SidebarAccountMenu onOpenSettings={onOpenSettings} onCreated={onNewProjectChat} />
          </div>
          <GuideButton />
        </div>
      </DesktopNavigationFooter>
    </Sidebar>
  )
}
