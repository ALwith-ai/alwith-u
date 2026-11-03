import type { SessionSummary } from "@alwith/module-chat/client"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"

import { isImageSession } from "@/agent/session-kind"
import { Pane } from "@/components/alwith-ui/pane"
import { toolboxContentClassName } from "@/components/alwith-ui/toolbox-layout"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { client } from "@/lib/client"

import { generatedImages, mergeGeneratedImages } from "./image-results"

type GalleryRecord = {
  images: ReturnType<typeof generatedImages>
  cursor: string | null
  loading: boolean
  error: string | null
}

const PAGE_SIZE = 12

/** Read-only projections of Codex history; no conversation or gallery index is persisted. */
export function ImageGallery({
  onPreview,
  contextSessionId,
  intro,
  footer,
  busy
}: {
  onPreview: (session: SessionSummary, images: ReturnType<typeof generatedImages>, index: number) => void
  contextSessionId?: string
  intro?: ReactNode
  footer?: ReactNode
  busy: boolean
}) {
  const { t } = useTranslation()
  const rows = useStore(client.store, (state) => state.sessionList)
  const sessions = useStore(client.store, (state) => state.sessions)
  const connection = useStore(client.store, (state) => state.connection)
  const listError = useStore(client.store, (state) => state.sessionListError)
  const paused = useRef(busy)
  paused.current = busy
  const entries = useMemo(
    () => rows.filter((row) => isImageSession(row) || row.sessionId === contextSessionId),
    [rows, contextSessionId]
  )
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [records, setRecords] = useState<Record<string, GalleryRecord>>({})
  const [attempt, setAttempt] = useState(0)
  const cache = useRef(new Map<string, string>())
  const mounted = useRef(false)
  const requests = useRef(new Map<string, Promise<void>>())
  const olderLoading = useRef(new Set<string>())
  const cursors = useRef(new Map<string, Set<string>>())
  const gallery = useMemo(
    () =>
      entries.slice(0, limit).map((row) => {
        const record = records[row.sessionId]
        const live = sessions[row.sessionId]
        const images = mergeGeneratedImages(record?.images ?? [], live ? generatedImages(live) : [])
        return { row, record, images }
      }),
    [entries, limit, records, sessions]
  )
  const hasImages = gallery.some(({ images }) => images.length > 0)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (connection !== "ready" || busy) return
    void client.listSessions({ reset: true }).catch(() => undefined)
  }, [connection, attempt, busy])

  useEffect(() => {
    if (connection !== "ready" || busy) return
    let disposed = false
    const queue = entries.slice(0, limit)
    const read = async () => {
      while (!disposed && !paused.current && queue.length > 0) {
        const row = queue.shift()!
        const id = row.sessionId
        await requests.current.get(id)
        if (disposed || paused.current) return
        const revision = `${attempt}:${row.updatedAt}`
        if (cache.current.get(id) === revision) continue
        const request = (async () => {
          if (mounted.current)
            setRecords((state) => ({
              ...state,
              [id]: {
                images: state[id]?.images ?? [],
                cursor: null,
                loading: true,
                error: null
              }
            }))
          try {
            // Running threads may not have durable history yet; use their live projection until completion.
            const live = client.state.sessions[id]
            const page =
              live?.attached && (live.items.length === 0 || live.state !== "idle")
                ? { session: live, cursor: null }
                : await client.readSessionHistory(id, row.cwd)
            if (!mounted.current || disposed || paused.current) return
            cache.current.set(id, revision)
            cursors.current.set(id, new Set(page.cursor ? [page.cursor] : []))
            setRecords((state) => ({
              ...state,
              [id]: {
                images: generatedImages(page.session),
                cursor: page.cursor,
                loading: false,
                error: null
              }
            }))
          } catch (error) {
            if (mounted.current && !disposed && !paused.current) {
              cache.current.set(id, revision)
              setRecords((state) => ({
                ...state,
                [id]: {
                  images: state[id]?.images ?? [],
                  cursor: null,
                  loading: false,
                  error: String(error)
                }
              }))
            }
          }
        })()
        requests.current.set(id, request)
        await request
        if (requests.current.get(id) === request) requests.current.delete(id)
      }
    }
    void Promise.all([read(), read()])
    return () => {
      disposed = true
    }
  }, [entries, limit, connection, attempt, busy])

  useEffect(() => {
    if (busy || connection !== "ready" || hasImages || entries.length <= limit) return
    if (gallery.some(({ record }) => !record || record.loading)) return
    setLimit((value) => Math.min(entries.length, value + PAGE_SIZE))
  }, [busy, connection, hasImages, entries.length, limit, gallery])

  const older = async (row: SessionSummary) => {
    const id = row.sessionId
    const record = records[id]
    if (busy || !record?.cursor || requests.current.has(id) || olderLoading.current.has(id)) return
    const revision = cache.current.get(id)
    olderLoading.current.add(id)
    setRecords((state) => ({ ...state, [id]: { ...record, loading: true, error: null } }))
    try {
      const page = await client.readSessionHistory(id, row.cwd, record.cursor)
      if (page.cursor && cursors.current.get(id)?.has(page.cursor))
        throw new Error("Image history repeated a pagination cursor")
      if (page.cursor && cache.current.get(id) === revision) cursors.current.get(id)?.add(page.cursor)
      if (mounted.current && !paused.current && cache.current.get(id) === revision)
        setRecords((state) => ({
          ...state,
          [id]: {
            images: mergeGeneratedImages(generatedImages(page.session), record.images),
            cursor: page.cursor,
            loading: false,
            error: null
          }
        }))
    } catch (error) {
      if (mounted.current && !paused.current && cache.current.get(id) === revision)
        setRecords((state) => ({ ...state, [id]: { ...record, loading: false, error: String(error) } }))
    } finally {
      olderLoading.current.delete(id)
    }
  }
  const refresh = () => {
    cache.current.clear()
    setAttempt((value) => value + 1)
  }
  const indexError = busy ? null : listError
  return (
    <section className="@container flex h-full min-h-0 flex-1 flex-col" aria-label={t("images.gallery")}>
      <Pane className="pe-0" viewportClassName="pe-0">
        <div className={`${toolboxContentClassName} pt-8`}>
          {intro}
          {hasImages && <h2 className="mt-10 mb-4 text-base font-medium">{t("images.myImages")}</h2>}
          <div className="space-y-6">
            {hasImages && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,144px),176px))] items-start gap-3">
                {gallery.flatMap(({ row, images }) =>
                  images.toReversed().map((image) => (
                    <button
                      key={`${row.sessionId}:${image.id}`}
                      type="button"
                      disabled={busy}
                      className="group overflow-hidden rounded-xl border border-border text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      onClick={() => onPreview(row, images, images.indexOf(image))}
                      aria-label={image.prompt || row.title || t("images.untitled")}
                    >
                      <img
                        className="aspect-[4/3] w-full bg-muted object-cover"
                        src={image.src}
                        alt={image.prompt || t("images.result")}
                        loading="lazy"
                      />
                    </button>
                  ))
                )}
              </div>
            )}
            {gallery.map(({ row, record }) => {
              return !busy && (record?.error || record?.cursor) ? (
                <div key={row.sessionId} className="flex items-center gap-2 text-sm">
                  <span className="truncate text-muted-foreground">{row.title || t("images.untitled")}</span>
                  {record.error && (
                    <p role="alert" className="text-destructive">
                      {t("images.loadFailed")}{" "}
                      <Button variant="ghost" size="xs" onClick={refresh}>
                        {t("images.retry")}
                      </Button>
                    </p>
                  )}
                  {record.cursor && (
                    <Button variant="ghost" size="sm" disabled={record.loading} onClick={() => void older(row)}>
                      {record.loading && <Spinner />}
                      {t("images.olderVersions")}
                    </Button>
                  )}
                </div>
              ) : null
            })}
            {hasImages && entries.length > limit && (
              <Button variant="outline" size="sm" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
                {t("images.loadMore")}
              </Button>
            )}
          </div>
          {indexError && (
            <div role="alert" className="mt-4 flex items-center gap-2 text-sm text-destructive">
              {t("images.loadFailed")}
              <Button variant="ghost" size="sm" onClick={refresh}>
                {t("images.retry")}
              </Button>
            </div>
          )}
        </div>
      </Pane>
      {footer}
    </section>
  )
}
