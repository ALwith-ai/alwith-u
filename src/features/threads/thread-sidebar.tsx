/**
 * ThreadSidebar — ALwith Desktop's `SessionsPanel` reduced for Codex threads: Codex's own
 * thread list grouped by project (real cwd), newest first. Group and row geometry are
 * Desktop's navigation primitives (`NavigationGroup` / `NavigationSessionItem`); row
 * actions live in the hover card, the row's trailing slot only ever shows the stop button.
 */
import { PictureInPicture2Icon } from "lucide-react"
import { openChatWindow } from "@/lib/chat-window"
import {
  ActivityIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  FolderClosedIcon,
  FolderIcon,
  FolderOpenIcon,
  GitForkIcon,
  PencilIcon,
  PlusIcon,
  BookOpenIcon,
  PuzzleIcon,
  SearchIcon,
  SettingsIcon,
  Trash2Icon,
  XIcon
} from "lucide-react"
import { motion } from "motion/react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { HoverInfoAction } from "@/components/alwith-ui/hover-info-card"
import { NavigationMenuIconButton } from "@/components/alwith-ui/navigation-menu-icon-button"
import { Pane } from "@/components/alwith-ui/pane"
import { RowStopButton } from "@/components/alwith-ui/row-more-menu"
import { MENU_HIGHLIGHT } from "@/components/alwith-ui/surface-highlight"
import { useStoryAvailable } from "@/features/story/use-story-available"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ThreadSummary } from "@/agent/client"
import { hasPluginStore, hasRename } from "@/agent/codex-extensions"
import { NavigationGroup } from "@/features/layout/components/navigation/navigation-group"
import { NavigationItemButton } from "@/features/layout/components/navigation/navigation-item"
import { NavigationSessionItem } from "@/features/layout/components/navigation/navigation-session-item"
import { NavigationStack } from "@/features/layout/components/navigation/navigation-stack"
import { client, useApp } from "@/lib/client"
import { runtimeClient } from "@/lib/runtime"
import { basename } from "@/lib/path"
import { isMac } from "@/lib/platform"
import type { RunState } from "@/lib/run-state"
import { displayShortcut } from "@/lib/shortcut-formatter"
import { cn } from "@/lib/utils"
import { ActivityPanel } from "./activity-panel"
import { type SidebarView, useThreadsUiStore } from "./store"
import { relativeTime, ThreadInfoCard } from "./thread-info-card"

/** Same predicate as Desktop's sessions panel: title or cwd contains the query; the id too. */
function matches(thread: ThreadSummary, query: string): boolean {
  if (!query) return true
  return (
    (thread.title ?? "").toLowerCase().includes(query) ||
    thread.cwd.toLowerCase().includes(query) ||
    thread.sessionId.toLowerCase().includes(query)
  )
}

function report(promise: Promise<unknown>) {
  promise.catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
}

/** Desktop's `DiskSessionRow`: state dot, title, time in the meta slot, stop button while alive. */
function ThreadRow({
  thread,
  active,
  state,
  onSelect,
  onDelete
}: {
  thread: ThreadSummary
  active: boolean
  state?: RunState
  onSelect: () => void
  onDelete: () => void
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
      hoverCard={<ThreadHoverBody thread={thread} onDelete={onDelete} />}
      meta={
        thread.updatedAt !== null ? (
          <span className="text-muted-foreground shrink-0 text-xs">
            {relativeTime(thread.updatedAt, i18n.language)}
          </span>
        ) : undefined
      }
      actions={
        state != null ? (
          <RowStopButton
            title={t("sidebar.stop")}
            onStop={() => report(runtimeClient().then(port => port.stopSession(thread.sessionId)))}
          />
        ) : undefined
      }
    />
  )
}

/** Desktop's `SessionHoverBody`: info card plus the row actions (rename / fork / archive / delete). */
function ThreadHoverBody({ thread, onDelete }: { thread: ThreadSummary; onDelete: () => void }) {
  const { t } = useTranslation()
  const canRename = useApp(state => hasRename(state.agent))
  const [renaming, setRenaming] = useState(false)
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
                onClick={() =>
                  report(
                    client
                      .fork(thread.sessionId, thread.cwd)
                      .then(id => client.open(id, thread.cwd))
                      .then(() => undefined)
                  )
                }
              />
              <HoverInfoAction
                icon={<ArchiveIcon />}
                label={t("sidebar.archive")}
                onClick={() => report(client.archive(thread.sessionId))}
              />
            </>
          )}
          <HoverInfoAction icon={<Trash2Icon />} label={t("sidebar.delete")} onClick={onDelete} />
        </>
      }
    />
  )
}

export function ThreadSidebar({
  selectedId,
  onSelect,
  onNewChat,
  onOpenSettings,
  onOpenPlugins,
  onOpenStory
}: {
  selectedId: string | null
  onSelect: (thread: ThreadSummary) => void
  onNewChat: () => void
  onOpenSettings: () => void
  onOpenPlugins: () => void
  onOpenStory: () => void
}) {
  const { t } = useTranslation()
  const pluginsAvailable = useApp(state => hasPluginStore(state.agent))
  const storyAvailable = useStoryAvailable()
  const threads = useApp(state => state.threads)
  const threadsCursor = useApp(state => state.threadsCursor)
  const archived = useApp(state => state.archivedThreads)
  const archivedLoaded = useApp(state => state.archivedLoaded)
  const archivedCursor = useApp(state => state.archivedCursor)
  const runStates = useApp(state => state.runStates)
  // 展开态放共享内存 store(Desktop 同款):应用运行期间保留,重启即清空。
  const projectOpen = useThreadsUiStore(s => s.projectOpen)
  const setProjectOpen = useThreadsUiStore(s => s.setProjectOpen)
  // 侧栏面板(Desktop 的 activeNavigationItem):会话列表 / 活动。
  const view = useThreadsUiStore(s => s.view)
  const setView = useThreadsUiStore(s => s.setView)
  // 标签组:与导航图标按钮共用 30px 行高和 hover,不带外层底板;
  // 选中 = 胶囊内 icon + 文字,未选中 = 纯 icon(Desktop atlas-layout 的那组,减到两项)。
  const tabs: { key: SidebarView; title: string; icon: React.ReactNode }[] = [
    { key: "sessions", title: t("sidebar.chats"), icon: <FolderIcon /> },
    { key: "activity", title: t("sidebar.activity"), icon: <ActivityIcon /> }
  ]
  const [pendingDelete, setPendingDelete] = useState<ThreadSummary | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()

  const groups = useMemo(() => {
    const byProject = new Map<string, ThreadSummary[]>()
    const sorted = threads
      .filter(thread => matches(thread, q))
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    for (const thread of sorted) {
      const list = byProject.get(thread.cwd)
      if (list) list.push(thread)
      else byProject.set(thread.cwd, [thread])
    }
    return [...byProject.entries()]
  }, [threads, q])
  const archivedShown = useMemo(() => archived.filter(thread => matches(thread, q)), [archived, q])

  const stateOf = (thread: ThreadSummary): RunState | undefined => runStates[thread.sessionId]?.state

  const rows = (list: ThreadSummary[]) =>
    list.map(thread => (
      <ThreadRow
        key={thread.sessionId}
        thread={thread}
        active={thread.sessionId === selectedId}
        state={stateOf(thread)}
        onSelect={() => onSelect(thread)}
        onDelete={() => setPendingDelete(thread)}
      />
    ))

  return (
    <Sidebar collapsible="none" className="h-full border-e bg-transparent [--navigation-row-height:30px]">
      <SidebarHeader className={cn(isMac() && "pt-9")} data-tauri-drag-region>
        <div className="flex items-center gap-2 px-1">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold" data-tauri-drag-region>
            {t("app.name")}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("chatWindow.open")}
            aria-label={t("chatWindow.open")}
            onClick={() =>
              void openChatWindow().catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : String(error))
              )
            }>
            <PictureInPicture2Icon />
          </Button>
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
        <InputGroup className="h-7">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t("sidebar.search")}
            aria-label={t("sidebar.search")}
            onKeyDown={event => {
              if (event.key === "Escape") setQuery("")
            }}
          />
          {query !== "" && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton aria-label={t("actions.close")} onClick={() => setQuery("")}>
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        <div className="relative flex h-[30px] shrink-0 items-center gap-0.5 [--navigation-row-height:30px]">
          <div
            role="tablist"
            className={`${MENU_HIGHLIGHT} bg-foreground/5 flex h-[30px] w-full flex-none items-center gap-0.5 rounded-[10px] [corner-shape:superellipse(1.5)]`}>
            {tabs.map(tab => {
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
      </SidebarHeader>
      <SidebarContent className="overflow-hidden">
        {view === "activity" ? (
          <ActivityPanel selectedId={selectedId} onSelect={onSelect} />
        ) : (
          <Pane viewportClassName="px-1 py-1">
            <NavigationStack>
              {q !== "" && groups.length === 0 && archivedShown.length === 0 && (
                <p className="text-muted-foreground px-3 py-6 text-center text-sm">{t("sidebar.noResults")}</p>
              )}
              {groups.map(([cwd, list]) => {
                const isOpen = projectOpen.get(cwd) ?? false
                return (
                  // 双层:组(项目,可折叠)→ 组内会话。受控折叠,展开态进共享 store。
                  <NavigationGroup
                    key={cwd}
                    open={isOpen}
                    onOpenChange={open => setProjectOpen(new Map(projectOpen).set(cwd, open))}
                    tooltip={cwd}
                    leading={
                      // 项目(工作区)分组显文件夹图标:展开=打开、折叠=关闭。
                      isOpen ? (
                        <FolderOpenIcon className="text-foreground size-3.5 shrink-0" />
                      ) : (
                        <FolderClosedIcon className="text-foreground size-3.5 shrink-0" />
                      )
                    }
                    label={basename(cwd)}
                    count={list.length}>
                    {rows(list)}
                  </NavigationGroup>
                )
              })}
              {threadsCursor !== null && q === "" && (
                <NavigationItemButton
                  className={`${MENU_HIGHLIGHT} text-muted-foreground`}
                  onClick={() => report(client.listThreads())}>
                  {t("sidebar.loadMore")}
                </NavigationItemButton>
              )}
              <NavigationGroup
                open={archivedOpen}
                onOpenChange={open => {
                  setArchivedOpen(open)
                  if (open && !archivedLoaded) report(client.listThreads({ archived: true }))
                }}
                leading={<ArchiveIcon className="text-foreground size-3.5 shrink-0" />}
                label={t("sidebar.archived")}
                count={archivedLoaded ? archivedShown.length : undefined}>
                {rows(archivedShown)}
                {archivedCursor !== null && q === "" && (
                  <NavigationItemButton
                    className={`${MENU_HIGHLIGHT} text-muted-foreground`}
                    onClick={() => report(client.listThreads({ archived: true }))}>
                    {t("sidebar.loadMore")}
                  </NavigationItemButton>
                )}
              </NavigationGroup>
            </NavigationStack>
          </Pane>
        )}
      </SidebarContent>
      <SidebarFooter className="[--navigation-row-height:30px]">
        {pluginsAvailable && (
          <NavigationItemButton className={MENU_HIGHLIGHT} onClick={onOpenPlugins}>
            <PuzzleIcon />
            <span>{t("sidebar.plugins")}</span>
          </NavigationItemButton>
        )}
        {storyAvailable && (
          <NavigationItemButton className={MENU_HIGHLIGHT} onClick={onOpenStory}>
            <BookOpenIcon />
            <span>{t("sidebar.story")}</span>
          </NavigationItemButton>
        )}
        <NavigationItemButton className={MENU_HIGHLIGHT} onClick={onOpenSettings}>
          <SettingsIcon />
          <span>{t("sidebar.settings")}</span>
        </NavigationItemButton>
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
