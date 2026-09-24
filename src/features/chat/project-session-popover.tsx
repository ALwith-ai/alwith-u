import { FolderClosedIcon, MessageSquareIcon, PlusIcon } from "lucide-react"
import { type ReactElement, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { ThreadSummary } from "@/agent/client"
import { OverflowMarquee } from "@/components/alwith-ui/overflow-marquee"
import { Pane } from "@/components/alwith-ui/pane"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { relativeTime } from "@/features/threads/thread-info-card"
import { ProjectPathAction } from "@/features/threads/project-path-action"
import { useProjectThreads } from "@/features/threads/use-project-threads"
import { basename } from "@/lib/path"

type ProjectActions = {
  cwd: string
  onSelect: (thread: ThreadSummary) => void
  onNewChat: () => void
}

/** Header click and sidebar hover share the same query and actions, as in Desktop. */
export function ProjectSessionPopover({
  cwd,
  onSelect,
  onNewChat,
  trigger
}: ProjectActions & { trigger?: ReactElement }) {
  const [open, setOpen] = useState(false)
  const skipFocus = useRef(false)
  const popupRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  const expandPointer = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (trigger === undefined || !open || !expanded) return
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
  }, [trigger, open, expanded])
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
        if (!value && expandPointer.current !== null && details.reason === "trigger-hover") {
          details.cancel()
          return
        }
        if (value && !open) {
          skipFocus.current = false
          expandPointer.current = null
          setExpanded(false)
        }
        setOpen(value)
      }}>
      {trigger === undefined ? (
        <PopoverTrigger
          ref={triggerRef}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="hover:bg-foreground/8 aria-expanded:bg-foreground/8 dark:hover:bg-foreground/8 shrink-0 transition-colors duration-150 ease-out"
              aria-label={basename(cwd)}
              title={cwd}
            />
          }>
          <FolderClosedIcon />
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
        side={trigger === undefined ? "bottom" : "right"}
        align="start"
        aria-label={basename(cwd)}
        initialFocus={trigger === undefined ? popupRef : false}
        finalFocus={() => !skipFocus.current}
        className="max-h-[var(--available-height)] w-80 max-w-[calc(100vw-1rem)] gap-0 overflow-hidden px-0 py-1">
        {open && (
          <ProjectContents
            key={cwd}
            cwd={cwd}
            showHeading={trigger === undefined}
            expanded={expanded}
            onExpand={(x, y) => {
              expandPointer.current = { x, y }
              setExpanded(true)
            }}
            onSelect={thread => leave(() => onSelect(thread))}
            onNewChat={() => leave(onNewChat)}
            onOpened={() => setOpen(false)}
          />
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
  onSelect,
  onNewChat,
  onOpened,
  showHeading,
  expanded,
  onExpand
}: ProjectActions & {
  onOpened: () => void
  showHeading: boolean
  expanded: boolean
  onExpand: (x: number, y: number) => void
}) {
  const { t, i18n } = useTranslation()
  const { result, retry } = useProjectThreads(cwd)
  const listRef = useRef<HTMLDivElement>(null)
  return (
    <>
      {showHeading && (
        <div className="flex min-h-8 items-center gap-2 px-3 py-1.5">
          <FolderClosedIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-semibold">{basename(cwd)}</span>
          <span className="text-muted-foreground shrink-0 text-xs" aria-live="polite">
            {result?.status === "ready" ? t("chat.project.chatCount", { count: result.threads.length }) : null}
          </span>
        </div>
      )}
      <Pane
        className="flex max-h-70 flex-auto flex-col"
        viewportClassName="h-auto min-h-0"
        viewportRef={listRef}
        viewportProps={{ tabIndex: -1 }}>
        {(result === undefined || result.status === "loading") && (
          <p role="status" className="text-muted-foreground px-3 py-2 text-sm">
            {t("chat.project.loading")}
          </p>
        )}
        {result?.status === "failed" && (
          <div className="px-3 py-2">
            <p role="alert" className="text-muted-foreground text-sm">
              {result.error}
            </p>
            <Button variant="ghost" size="sm" onClick={retry}>
              {t("actions.retry")}
            </Button>
          </div>
        )}
        {result?.status === "ready" && result.threads.length === 0 && (
          <p className="text-muted-foreground px-3 py-2 text-sm">{t("sidebar.noResults")}</p>
        )}
        {result?.status === "ready" &&
          (expanded ? result.threads : result.threads.slice(0, 5)).map(thread => (
            <Button
              key={thread.sessionId}
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start gap-2 rounded-none border-0 px-3 font-normal"
              aria-label={thread.title ?? t("sidebar.untitled")}
              onClick={() => onSelect(thread)}>
              <MessageSquareIcon />
              <OverflowMarquee className="flex-1 text-start">{thread.title ?? t("sidebar.untitled")}</OverflowMarquee>
              {thread.updatedAt !== null && (
                <span className="text-muted-foreground shrink-0 text-xs">
                  {relativeTime(thread.updatedAt, i18n.language)}
                </span>
              )}
            </Button>
          ))}
      </Pane>
      {result?.status === "ready" && !expanded && result.threads.length > 5 && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-8 justify-start rounded-none border-0 ps-9 pe-3"
          onClick={event => {
            onExpand(event.clientX, event.clientY)
            if (listRef.current === null) throw new Error("Project session list is not mounted")
            listRef.current.focus()
          }}>
          {t("actions.showMore")}
        </Button>
      )}
      <Separator />
      <ProjectPathAction cwd={cwd} onOpened={onOpened} />
      <Separator />
      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-2 rounded-none border-0 px-3 font-normal"
        onClick={onNewChat}>
        <PlusIcon />
        {t("sidebar.newChat")}
      </Button>
    </>
  )
}
