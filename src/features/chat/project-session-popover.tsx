import {
  OverflowMarquee,
  relativeTime,
  TRAILING_GROUP,
  TrailingSwap,
  useProjectSessions,
  useSidebarOverlay
} from "@alwith/module-chat/session-list"
import { FolderClosedIcon, MessageSquareIcon, PlusIcon } from "lucide-react"
import { type ReactElement, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import type { SessionSummary } from "@/agent/client"
import { client, useApp } from "@/lib/client"
import { Pane } from "@/components/alwith-ui/pane"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { CollectionPicker } from "@/features/collection/collection-menu"
import { ProjectPathAction } from "@/features/sessions/project-path-action"
import { SessionListHostProvider } from "@/features/sessions/session-list-host"
import { useChatWindowSurface, useMainWindowSurface } from "@/lib/chat-window-state"
import { basename } from "@/lib/path"
import { cn } from "@/lib/utils"

import { newChatDirectory } from "./new-chat-directory"

type ProjectActions = {
  actionLabel?: string
  cwd: string | null
  currentSessionId?: string | null
  onSelect: (sessionRow: SessionSummary) => void
  onNewChat: () => void
}

type DirectoryState =
  { status: "loading" } | { status: "ready"; cwd: string } | { status: "failed"; error: string; retry: () => void }

/** Quick chats share the sidebar group; the host's default workspace is only the folder action. */
export function ChatProjectMenu({ cwd, ...actions }: ProjectActions & { trigger?: ReactElement }) {
  const context = useApp(state => state.projectContext)
  const project = newChatDirectory(cwd, context)
  const [directory, setDirectory] = useState<DirectoryState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (project !== null) return
    // A retry belongs to this directory request, not a subsequently selected project.
    void attempt
    let active = true
    setDirectory({ status: "loading" })
    void client.refreshProjectContext(true).then(context => context.chatDirectory).then(
      (cwd) => {
        if (active) setDirectory({ status: "ready", cwd })
      },
      (error) => {
        if (active)
          setDirectory({
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
            retry: () => setAttempt((value) => value + 1)
          })
      }
    )
    return () => {
      active = false
    }
  }, [project, attempt])
  return (
    <ProjectPopover
      {...actions}
      cwd={project}
      directory={project === null ? directory : { status: "ready", cwd: project }}
    />
  )
}

/** Sidebar hover and header click resolve the same group and folder. */
export function ProjectSessionPopover(props: ProjectActions & { trigger?: ReactElement }) {
  return <ChatProjectMenu {...props} />
}

/** Header click and sidebar hover share the same list and actions, as in Desktop. */
function ProjectPopover({
  actionLabel,
  cwd,
  currentSessionId,
  directory,
  onSelect,
  onNewChat,
  trigger
}: ProjectActions & {
  directory: DirectoryState
  trigger?: ReactElement
}) {
  const { t } = useTranslation()
  const label = cwd === null ? t("sidebar.quickChats") : basename(cwd)
  const [open, setOpen] = useState(false)
  useSidebarOverlay(open)
  const skipFocus = useRef(false)
  const popupRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [collectionOpen, setCollectionOpen] = useState(false)
  const expandPointer = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (trigger === undefined || !open || !expanded || collectionOpen) return
    const popup = popupRef.current
    const projectTrigger = triggerRef.current
    if (popup === null || projectTrigger === null) throw new Error("Project popup is not mounted")
    let reachedPopup = false
    const onMouseMove = (event: MouseEvent) => {
      const { clientX: x, clientY: y } = event
      const previous = expandPointer.current
      if (previous !== null && previous.x === x && previous.y === y) return
      expandPointer.current = { x, y }
      const target = event.target
      if (target instanceof Node && (popup.contains(target) || projectTrigger.contains(target))) {
        reachedPopup = true
        return
      }
      const popupBounds = popup.getBoundingClientRect()
      if (
        !reachedPopup &&
        previous !== null &&
        distanceToPopup({ x, y }, popupBounds) <= distanceToPopup(previous, popupBounds)
      )
        return
      const triggerBounds = projectTrigger.getBoundingClientRect()
      const inHorizontalGap =
        y >= Math.max(popupBounds.top, triggerBounds.top) &&
        y <= Math.min(popupBounds.bottom, triggerBounds.bottom) &&
        ((x >= triggerBounds.right && x <= popupBounds.left) || (x >= popupBounds.right && x <= triggerBounds.left))
      const inVerticalGap =
        x >= Math.max(popupBounds.left, triggerBounds.left) &&
        x <= Math.min(popupBounds.right, triggerBounds.right) &&
        ((y >= triggerBounds.bottom && y <= popupBounds.top) || (y >= popupBounds.bottom && y <= triggerBounds.top))
      if (!inHorizontalGap && !inVerticalGap) setOpen(false)
    }
    document.addEventListener("mousemove", onMouseMove)
    return () => document.removeEventListener("mousemove", onMouseMove)
  }, [trigger, open, expanded, collectionOpen])
  const leave = (action: () => void) => {
    skipFocus.current = true
    setOpen(false)
    action()
  }
  return (
    <Popover
      open={open}
      onOpenChange={(value, details) => {
        if (trigger !== undefined && details.reason === "trigger-press") {
          details.cancel()
          return
        }
        if (!value && (expandPointer.current !== null || collectionOpen) && details.reason === "trigger-hover") {
          details.cancel()
          return
        }
        if (value && !open) {
          skipFocus.current = false
          expandPointer.current = null
          setExpanded(false)
          setCollectionOpen(false)
        }
        setOpen(value)
      }}
    >
      {trigger === undefined ? (
        <PopoverTrigger
          ref={triggerRef}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 transition-colors duration-150 ease-out hover:bg-foreground/8 aria-expanded:bg-foreground/8 dark:hover:bg-foreground/8"
              aria-label={actionLabel ?? label}
              title={actionLabel ?? cwd ?? label}
            />
          }
        >
          {actionLabel ? <MessageSquareIcon /> : <FolderClosedIcon />}
        </PopoverTrigger>
      ) : (
        <PopoverTrigger
          ref={triggerRef}
          openOnHover
          nativeButton={false}
          role="presentation"
          tabIndex={-1}
          render={trigger}
        />
      )}
      <PopoverContent
        ref={popupRef}
        side={trigger === undefined ? "bottom" : "inline-end"}
        align="start"
        aria-label={label}
        initialFocus={trigger === undefined ? popupRef : false}
        finalFocus={() => !skipFocus.current}
        className="max-h-[var(--available-height)] w-80 max-w-[calc(100vw-1rem)] gap-0 overflow-hidden p-1"
      >
        {open && (
          // The popover also opens from chat headers, outside the sidebar's session list.
          <SessionListHostProvider>
            <ProjectContents
              key={cwd ?? "quick-chats"}
              cwd={cwd}
              currentSessionId={currentSessionId}
              directory={directory}
              showHeading={trigger === undefined}
              expanded={expanded}
              onExpand={(x, y) => {
                expandPointer.current = { x, y }
                setExpanded(true)
              }}
              onSelect={(sessionRow) => leave(() => onSelect(sessionRow))}
              onNewChat={() => leave(onNewChat)}
              onOpened={() => setOpen(false)}
              onCollectionOpenChange={setCollectionOpen}
            />
          </SessionListHostProvider>
        )}
      </PopoverContent>
    </Popover>
  )
}

function distanceToPopup(point: { x: number; y: number }, bounds: DOMRect): number {
  const horizontal = point.x < bounds.left ? bounds.left - point.x : point.x > bounds.right ? point.x - bounds.right : 0
  const vertical = point.y < bounds.top ? bounds.top - point.y : point.y > bounds.bottom ? point.y - bounds.bottom : 0
  return Math.hypot(horizontal, vertical)
}

function ProjectContents({
  cwd,
  currentSessionId,
  directory,
  onSelect,
  onNewChat,
  onOpened,
  showHeading,
  expanded,
  onExpand,
  onCollectionOpenChange
}: ProjectActions & {
  directory: DirectoryState
  onOpened: () => void
  showHeading: boolean
  expanded: boolean
  onExpand: (x: number, y: number) => void
  onCollectionOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const { result, retry } = useProjectSessions(cwd)
  const mainSessionId = useMainWindowSurface((state) => (state.visible ? state.sessionId : null))
  const chatSessionId = useChatWindowSurface((state) => (state.visible ? state.sessionId : null))
  const sessionRows =
    result?.status === "ready"
      ? result.sessionRows.filter(
          (sessionRow) =>
            sessionRow.sessionId !== currentSessionId &&
            sessionRow.sessionId !== mainSessionId &&
            sessionRow.sessionId !== chatSessionId
        )
      : []
  const listRef = useRef<HTMLDivElement>(null)
  return (
    <>
      {showHeading && (
        <div className="flex min-h-8 items-center gap-2 px-3 py-1.5">
          <FolderClosedIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-medium">
            {cwd === null ? t("sidebar.quickChats") : basename(cwd)}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
            {result?.status === "ready" ? t("chat.project.chatCount", { count: sessionRows.length }) : null}
          </span>
        </div>
      )}
      <Pane
        className="flex max-h-70 flex-auto flex-col pe-0"
        viewportClassName="h-auto min-h-0 pe-0"
        viewportRef={listRef}
        viewportProps={{ tabIndex: -1 }}
      >
        {(result === undefined || result.status === "loading") && (
          <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
            {t("chat.project.loading")}
          </p>
        )}
        {result?.status === "failed" && (
          <div className="px-3 py-2">
            <p role="alert" className="text-sm text-muted-foreground">
              {result.error}
            </p>
            <Button variant="ghost" size="sm" onClick={retry}>
              {t("actions.retry")}
            </Button>
          </div>
        )}
        {result?.status === "ready" && sessionRows.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted-foreground">{t("sidebar.noResults")}</p>
        )}
        {result?.status === "ready" &&
          (expanded ? sessionRows : sessionRows.slice(0, 5)).map((sessionRow) => (
            <div
              key={sessionRow.sessionId}
              className={cn(
                TRAILING_GROUP,
                "flex h-8 w-full items-center gap-2 rounded-sm px-2 focus-within:bg-accent hover:bg-accent"
              )}
            >
              <Button
                variant="ghost"
                size="sm"
                className="h-8 min-w-0 flex-1 justify-start gap-2 rounded-sm border-0 p-0 font-normal hover:bg-transparent dark:hover:bg-transparent"
                data-hover-background="none"
                aria-label={sessionRow.title ?? t("sidebar.untitled")}
                onClick={() => onSelect(sessionRow)}
              >
                <MessageSquareIcon />
                <OverflowMarquee className="flex-1 text-start">
                  {sessionRow.title ?? t("sidebar.untitled")}
                </OverflowMarquee>
              </Button>
              <TrailingSwap
                content={
                  sessionRow.updatedAt !== null ? (
                    <span className="text-xs text-muted-foreground">
                      {relativeTime(sessionRow.updatedAt, i18n.language)}
                    </span>
                  ) : undefined
                }
                actions={
                  <CollectionPicker
                    sessionId={sessionRow.sessionId}
                    favorite
                    className="size-6 [&_svg]:size-3.5"
                    onOpenChange={onCollectionOpenChange}
                  />
                }
              />
            </div>
          ))}
      </Pane>
      {result?.status === "ready" && !expanded && sessionRows.length > 5 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 justify-start rounded-sm border-0 ps-8 pe-2 font-normal text-muted-foreground hover:bg-accent"
          onClick={(event) => {
            onExpand(event.clientX, event.clientY)
            if (listRef.current === null) throw new Error("Project session list is not mounted")
            listRef.current.focus()
          }}
        >
          {t("actions.showMore")}
        </Button>
      )}
      <Separator />
      {directory.status === "ready" && <ProjectPathAction cwd={directory.cwd} onOpened={onOpened} />}
      {directory.status === "loading" && (
        <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
          {t("chat.project.loading")}
        </p>
      )}
      {directory.status === "failed" && (
        <div className="px-3 py-2">
          <p role="alert" className="text-sm text-muted-foreground">
            {directory.error}
          </p>
          <Button variant="ghost" size="sm" onClick={directory.retry}>
            {t("actions.retry")}
          </Button>
        </div>
      )}
      <Separator />
      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-2 rounded-sm border-0 px-2 font-normal hover:bg-accent"
        onClick={onNewChat}
      >
        <PlusIcon />
        {t("sidebar.newChat")}
      </Button>
    </>
  )
}
