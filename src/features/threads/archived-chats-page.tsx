import { ScrollArea } from "@base-ui/react/scroll-area"
import { ArchiveIcon, FolderIcon, ListFilterIcon, SearchIcon, Trash2Icon } from "lucide-react"
import { type ReactElement, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { ThreadSummary } from "@/agent/client"
import { Pane } from "@/components/alwith-ui/pane"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { client, useApp } from "@/lib/client"
import { basename } from "@/lib/path"
import { groupThreads, isQuickChatDirectory, QUICK_CHATS_GROUP } from "./thread-groups"

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ArchivedChatsPage(): ReactElement {
  const { t, i18n } = useTranslation()
  const threads = useApp(state => state.archivedThreads)
  const connection = useApp(state => state.connection)
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState("all")
  const [project, setProject] = useState("all")
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [pendingDelete, setPendingDelete] = useState<ThreadSummary[] | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletingAll, setDeletingAll] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry starts a new complete archive fetch after a failure.
  useEffect(() => {
    if (connection !== "ready") return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    async function load(): Promise<void> {
      try {
        await client.listThreads({ archived: true, reset: true })
        const cursors = new Set<string>()
        while (!cancelled && client.state.archivedCursor !== null) {
          const cursor = client.state.archivedCursor
          if (cursors.has(cursor)) throw new Error("Archive pagination returned a repeated cursor")
          cursors.add(cursor)
          await client.listThreads({ archived: true })
        }
      } catch (error) {
        if (!cancelled) setLoadError(describe(error))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [connection, reload])

  const ready = connection === "ready" && !loading && loadError === null
  const disabled = !ready || busy
  const title = (thread: ThreadSummary): string => thread.title ?? t("sidebar.untitled")
  const projects = [
    ...new Set(threads.filter(thread => !isQuickChatDirectory(thread.cwd)).map(thread => thread.cwd))
  ].sort()
  const search = query.trim().toLocaleLowerCase(i18n.language)
  const filtered = threads.filter(thread => {
    const quick = isQuickChatDirectory(thread.cwd)
    return (
      title(thread).toLocaleLowerCase(i18n.language).includes(search) &&
      (kind === "all" || (kind === "quick" ? quick : !quick)) &&
      (project === "all" || (project === "quick" ? quick : thread.cwd === project))
    )
  })
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" })

  async function restore(thread: ThreadSummary): Promise<void> {
    if (working.current) return
    working.current = true
    setBusy(true)
    setActionError(null)
    try {
      await client.unarchive(thread.sessionId)
    } catch (error) {
      setActionError(describe(error))
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  async function deleteChats(): Promise<void> {
    if (working.current || !pendingDelete) return
    working.current = true
    setBusy(true)
    setDeleteError(null)
    const failed: ThreadSummary[] = []
    const errors: string[] = []
    try {
      for (const thread of pendingDelete) {
        // A chat restored in another surface after confirmation must not be deleted.
        if (!client.state.archivedThreads.some(item => item.sessionId === thread.sessionId)) continue
        try {
          await client.delete(thread.sessionId)
        } catch (error) {
          failed.push(thread)
          errors.push(`${title(thread)}: ${describe(error)}`)
        }
      }
      if (failed.length) {
        setPendingDelete(failed)
        setDeleteError(errors.join("\n"))
      } else {
        setPendingDelete(null)
      }
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={t("archives.title")}>
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10 lg:px-10 lg:py-14">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{t("archives.title")}</h1>
          <Button
            variant="destructive"
            className="text-[color-mix(in_oklab,var(--destructive)_80%,var(--foreground))]"
            disabled={disabled || threads.length === 0}
            onClick={() => {
              setDeleteError(null)
              setDeletingAll(true)
              setPendingDelete([...threads])
            }}>
            <Trash2Icon aria-hidden="true" />
            {t("archives.deleteAll")}
          </Button>
        </header>

        <div className="flex shrink-0 flex-wrap gap-3">
          <div className="relative min-w-48 flex-1">
            <SearchIcon
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute start-3 top-2.5 size-4"
            />
            <Input
              aria-label={t("archives.search")}
              placeholder={t("archives.search")}
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="rounded-full ps-9"
            />
          </div>
          <Select
            value={kind}
            onValueChange={value => {
              if (value === null) throw new Error("Archive chat type cannot be empty")
              setKind(value)
            }}>
            <SelectTrigger aria-label={t("archives.chatType")} className="min-w-40 rounded-xl">
              <ListFilterIcon aria-hidden="true" />
              <SelectValue>
                {t(`archives.${kind === "all" ? "allChats" : kind === "quick" ? "quickChats" : "projectChats"}`)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("archives.allChats")}</SelectItem>
              <SelectItem value="quick">{t("archives.quickChats")}</SelectItem>
              <SelectItem value="project">{t("archives.projectChats")}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={project}
            onValueChange={value => {
              if (value === null) throw new Error("Archive project filter cannot be empty")
              setProject(value)
            }}>
            <SelectTrigger aria-label={t("archives.project")} className="max-w-64 min-w-40 rounded-xl">
              <FolderIcon aria-hidden="true" />
              <SelectValue className="truncate">
                {project === "all"
                  ? t("archives.allProjects")
                  : project === "quick"
                    ? t("archives.noProject")
                    : basename(project)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("archives.allProjects")}</SelectItem>
              <SelectItem value="quick">{t("archives.noProject")}</SelectItem>
              {projects.map(cwd => (
                <SelectItem key={cwd} value={cwd} title={cwd}>
                  {basename(cwd)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Pane className="[&>[data-slot=scroll-area-scrollbar]]:translate-x-[18px]">
          <ScrollArea.Content className="flex flex-col gap-8" style={{ minWidth: 0 }}>
            {connection !== "ready" ? (
              <p role="status" className="text-muted-foreground">
                {t("archives.connecting")}
              </p>
            ) : loading ? (
              <div role="status" className="text-muted-foreground flex items-center gap-2">
                <Spinner />
                {t("archives.loading")}
              </div>
            ) : loadError ? (
              <Alert variant="destructive">
                <AlertDescription className="flex items-center justify-between gap-4">
                  <span>{loadError}</span>
                  <Button variant="outline" onClick={() => setReload(value => value + 1)}>
                    {t("archives.retry")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : threads.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center gap-3 py-16">
                <ArchiveIcon aria-hidden="true" className="size-8" />
                <p>{t("archives.empty")}</p>
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-muted-foreground py-12 text-center">{t("archives.noResults")}</p>
            ) : (
              groupThreads(filtered)
                .filter(([, items]) => items.length > 0)
                .map(([cwd, items]) => (
                  <section key={cwd} className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <h2
                        className="flex min-w-0 items-center gap-2 text-sm font-medium"
                        title={cwd === QUICK_CHATS_GROUP ? undefined : cwd}>
                        <FolderIcon aria-hidden="true" className="size-4 shrink-0" />
                        <span className="truncate">
                          {cwd === QUICK_CHATS_GROUP ? t("archives.noProject") : basename(cwd)}
                        </span>
                      </h2>
                      <span className="text-muted-foreground shrink-0 text-sm">
                        {t("archives.count", { count: items.length })}
                      </span>
                    </div>
                    <div className="divide-border divide-y overflow-hidden rounded-2xl border">
                      {items.map(thread => (
                        <article
                          key={thread.sessionId}
                          aria-label={title(thread)}
                          className="flex flex-wrap items-center gap-4 px-4 py-3">
                          <div className="min-w-0 flex-1 basis-40">
                            <h3 className="truncate text-sm font-medium" title={title(thread)}>
                              {title(thread)}
                            </h3>
                            {thread.updatedAt !== null && (
                              <time
                                dateTime={thread.updatedAt}
                                title={t("archives.updatedAt")}
                                className="text-muted-foreground text-xs">
                                {dateFormat.format(new Date(thread.updatedAt))}
                              </time>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("sidebar.delete")}
                              title={t("sidebar.delete")}
                              disabled={disabled}
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                setDeleteError(null)
                                setDeletingAll(false)
                                setPendingDelete([thread])
                              }}>
                              <Trash2Icon aria-hidden="true" />
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={disabled}
                              onClick={() => void restore(thread)}>
                              {t("archives.unarchive")}
                            </Button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))
            )}
            {actionError && (
              <Alert variant="destructive">
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            )}
          </ScrollArea.Content>
        </Pane>
      </div>
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={open => {
          if (!open && !working.current) setPendingDelete(null)
        }}>
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>{t("archives.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t(deletingAll ? "archives.deleteAllDescription" : "archives.deleteDescription", {
                count: pendingDelete?.length ?? 0
              })}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <Alert variant="destructive">
              <AlertDescription className="max-h-40 overflow-auto whitespace-pre-wrap">{deleteError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setPendingDelete(null)}>
              {t("actions.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="text-[color-mix(in_oklab,var(--destructive)_80%,var(--foreground))]"
              disabled={disabled}
              onClick={() => void deleteChats()}>
              {busy && <Spinner />}
              {t("archives.confirmDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
