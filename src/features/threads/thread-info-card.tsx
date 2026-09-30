// The thread row's hover card: ALwith Desktop's `SessionInfoCard` on `HoverInfoCard`.
// First line is the full title (the row truncates it), then the working directory and
// the time, one line each; row actions sit at the bottom of the card. Renaming turns the
// title into Desktop's inline input (Enter commits, Escape cancels, blur commits).
import { formatDistanceToNowStrict } from "date-fns"
import { enUS, zhCN } from "date-fns/locale"
import { ClockIcon, MessageSquareIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { ThreadSummary } from "@/agent/client"
import { HoverInfoCard, type HoverInfoRow } from "@/components/alwith-ui/hover-info-card"
import { OverflowMarquee } from "@/components/alwith-ui/overflow-marquee"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  useNavigationHoverCardClose,
  useNavigationHoverCardPin
} from "@/features/layout/components/navigation/navigation-session-item"
import { ProjectPathAction } from "./project-path-action"

const DATE_FNS_LOCALES = { en: enUS, "zh-CN": zhCN } as const

/** Strict short distance, no "ago" suffix (e.g. "3 days" or its localized equivalent), like Desktop's session rows. */
export function relativeTime(iso: string, language: string): string {
  const locale = language === "zh-CN" ? DATE_FNS_LOCALES["zh-CN"] : DATE_FNS_LOCALES.en
  return formatDistanceToNowStrict(new Date(iso), { locale })
}

export function ThreadInfoCard({
  thread,
  actions,
  renaming = false,
  onRename
}: {
  thread: ThreadSummary
  actions?: ReactNode
  /** Title shows as an input; the card stays pinned while it is open. */
  renaming?: boolean
  /** Called with the trimmed new name (or `null` when cancelled or unchanged). */
  onRename?: (name: string | null) => void
}) {
  const { t, i18n } = useTranslation()
  const pin = useNavigationHoverCardPin()
  const close = useNavigationHoverCardClose()
  useEffect(() => {
    pin(renaming)
  }, [renaming, pin])
  const [draft, setDraft] = useState(thread.title ?? "")
  useEffect(() => {
    if (renaming) setDraft(thread.title ?? "")
  }, [renaming, thread.title])
  const commit = (value: string) => {
    const next = value.trim()
    onRename?.(next !== "" && next !== thread.title ? next : null)
  }
  const time = thread.archived
    ? t("sidebar.archived")
    : thread.updatedAt !== null
      ? relativeTime(thread.updatedAt, i18n.language)
      : null
  const details: HoverInfoRow[] = []
  if (time !== null) details.push({ icon: <ClockIcon className="size-3.5" />, text: time })
  return (
    <HoverInfoCard
      title={
        renaming ? (
          <Input
            autoFocus
            value={draft}
            className="h-7 text-sm"
            aria-label={t("sidebar.rename")}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              event.stopPropagation()
              if (event.key === "Enter") commit((event.target as HTMLInputElement).value)
              if (event.key === "Escape") onRename?.(null)
            }}
            onBlur={event => commit(event.target.value)}
          />
        ) : (
          <OverflowMarquee className="block">{thread.title ?? t("sidebar.untitled")}</OverflowMarquee>
        )
      }
      titleIcon={<MessageSquareIcon className="size-3.5" />}
      details={details}
      actions={
        <>
          <ProjectPathAction cwd={thread.cwd} onOpened={close} appearance="session" />
          {actions !== undefined && (
            <>
              <Separator />
              {actions}
            </>
          )}
        </>
      }
    />
  )
}
