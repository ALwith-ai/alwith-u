import { openPath } from "@tauri-apps/plugin-opener"
import { ArrowUpRightIcon, FolderClosedIcon, FolderOpenIcon, MessageSquareIcon, PlusIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { ThreadSummary } from "@/agent/client"
import { OverflowMarquee } from "@/components/alwith-ui/overflow-marquee"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { relativeTime } from "@/features/threads/thread-info-card"
import { client, useApp } from "@/lib/client"
import { basename } from "@/lib/path"

type ProjectActions = {
  cwd: string
  onSelect: (thread: ThreadSummary) => void
  onNewChat: () => void
}

/** U's main header: transient project query, with all actions routed through the existing host. */
export function ProjectSessionPopover({ cwd, onSelect, onNewChat }: ProjectActions) {
  const [open, setOpen] = useState(false)
  const skipFocus = useRef(false)
  const popupRef = useRef<HTMLDivElement>(null)
  const leave = (action: () => void) => {
    skipFocus.current = true
    setOpen(false)
    action()
  }
  return (
    <Popover
      open={open}
      onOpenChange={value => {
        if (value) skipFocus.current = false
        setOpen(value)
      }}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-sm" className="shrink-0" aria-label={basename(cwd)} title={cwd} />}>
        <FolderClosedIcon />
      </PopoverTrigger>
      <PopoverContent
        ref={popupRef}
        side="bottom"
        align="start"
        aria-label={basename(cwd)}
        initialFocus={popupRef}
        finalFocus={() => !skipFocus.current}
        className="max-h-[var(--available-height)] w-80 max-w-[calc(100vw-1rem)] gap-0 overflow-hidden px-0 py-1">
        {open && (
          <ProjectContents
            key={cwd}
            cwd={cwd}
            onSelect={thread => leave(() => onSelect(thread))}
            onNewChat={() => leave(onNewChat)}
            onOpened={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

type ProjectResult =
  { status: "loading" } | { status: "failed"; error: string } | { status: "ready"; threads: ThreadSummary[] }

function ProjectContents({ cwd, onSelect, onNewChat, onOpened }: ProjectActions & { onOpened: () => void }) {
  const { t, i18n } = useTranslation()
  const [result, setResult] = useState<ProjectResult>({ status: "loading" })
  const [expanded, setExpanded] = useState(false)
  const [retry, setRetry] = useState(0)
  const [opening, setOpening] = useState(false)
  const openingRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  // Renames, deletions and new chats from either window invalidate the open query.
  const threads = useApp(state => state.threads)
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry and source-list changes explicitly invalidate this remote query.
  useEffect(() => {
    let alive = true
    setResult({ status: "loading" })
    void client
      .connect()
      .then(() => client.listProjectThreads(cwd))
      .then(entries => {
        if (alive)
          setResult({
            status: "ready",
            threads: entries.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
          })
      })
      .catch((error: unknown) => {
        if (alive) setResult({ status: "failed", error: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      alive = false
    }
  }, [cwd, retry, threads])
  const openFolder = async () => {
    if (openingRef.current) return
    openingRef.current = true
    setOpening(true)
    try {
      await openPath(cwd)
      onOpened()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      openingRef.current = false
      setOpening(false)
    }
  }
  return (
    <>
      <div className="flex items-center gap-2 border border-transparent px-3 py-1.5">
        <FolderClosedIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-semibold">{basename(cwd)}</span>
        <span className="text-muted-foreground shrink-0 text-xs" aria-live="polite">
          {result.status === "ready" ? t("chat.project.chatCount", { count: result.threads.length }) : null}
        </span>
      </div>
      <div ref={listRef} tabIndex={-1} className="max-h-70 min-h-0 overflow-y-auto outline-none">
        {result.status === "loading" && (
          <p role="status" className="text-muted-foreground px-3 py-2 text-sm">
            {t("chat.project.loading")}
          </p>
        )}
        {result.status === "failed" && (
          <div className="px-3 py-2">
            <p role="alert" className="text-muted-foreground text-sm">
              {result.error}
            </p>
            <Button variant="ghost" size="sm" onClick={() => setRetry(value => value + 1)}>
              {t("actions.retry")}
            </Button>
          </div>
        )}
        {result.status === "ready" && result.threads.length === 0 && (
          <p className="text-muted-foreground px-3 py-2 text-sm">{t("sidebar.noResults")}</p>
        )}
        {result.status === "ready" &&
          (expanded ? result.threads : result.threads.slice(0, 5)).map(thread => (
            <Button
              key={thread.sessionId}
              variant="ghost"
              size="sm"
              className="h-7 w-full justify-start gap-2 rounded-none px-3 font-normal"
              aria-label={thread.title ?? t("sidebar.untitled")}
              onClick={() => onSelect(thread)}>
              <MessageSquareIcon />
              <span className="min-w-0 flex-1 truncate text-start">{thread.title ?? t("sidebar.untitled")}</span>
              {thread.updatedAt !== null && (
                <span className="text-muted-foreground shrink-0 text-xs">
                  {relativeTime(thread.updatedAt, i18n.language)}
                </span>
              )}
            </Button>
          ))}
      </div>
      {result.status === "ready" && !expanded && result.threads.length > 5 && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-7 justify-start ps-9 pe-3"
          onClick={() => {
            setExpanded(true)
            if (listRef.current === null) throw new Error("Project session list is not mounted")
            listRef.current.focus()
          }}>
          {t("actions.showMore")}
        </Button>
      )}
      <Separator />
      <Button
        variant="ghost"
        size="sm"
        disabled={opening}
        aria-label={t("actions.openFolder")}
        title={cwd}
        className="group/path w-full justify-start gap-2 px-3 font-normal"
        onClick={() => void openFolder()}>
        <FolderOpenIcon />
        <OverflowMarquee className="flex-1 text-start">{cwd}</OverflowMarquee>
        <ArrowUpRightIcon className="invisible shrink-0 group-hover/path:visible group-focus-visible/path:visible" />
      </Button>
      <Separator />
      <Button variant="ghost" size="sm" className="justify-start gap-2 px-3 font-normal" onClick={onNewChat}>
        <PlusIcon />
        {t("sidebar.newChat")}
      </Button>
    </>
  )
}
