/**
 * ActivityPanel adapts ALwith Desktop's Activity panel: active sessions from Runtime's run-state registry,
 * shown hierarchically with a main agent row and running subagent rows beneath it.
 *
 * - Main agent row = session (using the same row component as session columns), in ascending chronological order for stable positioning:
 *   older sessions stay above new sessions appended at the bottom; state colors provide the attention cue.
 * - Subagent rows = running tasks parsed by Runtime from ACP traffic and removed on completion, showing what a long-running session
 *   is doing and which background tasks remain outstanding.
 * - Group by host: foreground is the currently viewed session (always flat, with no group header), followed by background running sessions.
 *   Click a row to open it; the trailing ✕ stops it (Runtime finds the agent by session and terminates the process).
 * This app has one window and no ALwith.dev: Desktop's window badges, execution leases (dev group), and ownerless rows are omitted.
 */

import type { SessionRunState, SessionTask } from "@alwith/api"
import { ActivityIcon } from "lucide-react"
import { useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { ThreadSummary } from "@/agent/client"
import { Pane } from "@/components/alwith-ui/pane"
import { RowStopButton } from "@/components/alwith-ui/row-more-menu"
import { SessionStateDot } from "@/components/alwith-ui/session-state-dot"
import { Kbd } from "@/components/ui/kbd"
import { NavigationGroup } from "@/features/layout/components/navigation/navigation-group"
import { NavigationSessionItem } from "@/features/layout/components/navigation/navigation-session-item"
import { NavigationStack } from "@/features/layout/components/navigation/navigation-stack"
import { useCmdHeld } from "@/hooks/use-cmd-held"
import { stopSession, useApp } from "@/lib/client"
import type { RunState } from "@/lib/run-state"
import { formatShortcutForDisplay } from "@/lib/shortcut-formatter"
import { activityGroupOf } from "./lib/activity-group"
import { useThreadsUiStore } from "./store"
import { ThreadInfoCard } from "./thread-info-card"

function report(promise: Promise<unknown>) {
  promise.catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
}

/** The thread behind a run state: the listed one, else a summary built from the Runtime's record. */
function threadOf(threads: ThreadSummary[], record: SessionRunState): ThreadSummary {
  return (
    threads.find(thread => thread.sessionId === record.sessionId) ?? {
      sessionId: record.sessionId,
      cwd: record.cwd,
      title: record.title || null,
      updatedAt: null,
      archived: false
    }
  )
}

export function ActivityPanel({
  selectedId,
  onSelect
}: {
  selectedId: string | null
  onSelect: (thread: ThreadSummary) => void
}) {
  const { t } = useTranslation()
  const runStates = useApp(state => state.runStates)
  const threads = useApp(state => state.threads)
  const draftSessions = useApp(state => state.draftSessions)

  // Sort by the thread's most recent update time in ascending order: older entries first, new sessions appended like a log.
  // Desktop uses creation time from its on-disk session table; Codex's thread list only exposes updatedAt, the closest available value.
  // Sessions absent from the list sort last.
  const updatedAt = useMemo(
    () =>
      new Map(
        threads.map(thread => [thread.sessionId, thread.updatedAt ? new Date(thread.updatedAt).getTime() : Infinity])
      ),
    [threads]
  )
  // Exclude only unsent drafts; Runtime remains authoritative for every conversation's activity.
  const rows = useMemo(
    () =>
      Object.values(runStates)
        .filter(record => !draftSessions[record.sessionId])
        .map(record => ({ sid: record.sessionId, record, thread: threadOf(threads, record) }))
        .sort((a, b) => (updatedAt.get(a.sid) ?? Infinity) - (updatedAt.get(b.sid) ?? Infinity)),
    [runStates, threads, updatedAt, draftSessions]
  )

  // Foreground means occupying the visible Chat slot: in this single-window app, that is the selected session.
  const groups = useMemo(() => {
    const byKey = new Map<string, typeof rows>()
    for (const row of rows) {
      const key = activityGroupOf({ visible: row.sid === selectedId })
      const bucket = byKey.get(key) ?? []
      bucket.push(row)
      byKey.set(key, bucket)
    }
    return (
      ["foreground", "background"]
        // Keep the Background header visible even with zero tasks: it is a permanent destination, not a section that appears only when tasks exist.
        // Omit the foreground group when empty.
        .filter(key => byKey.has(key) || key === "background")
        .map(key => ({
          key,
          label: key === "background" ? t("sidebar.background") : t("sidebar.foreground"),
          // Background uses fixed Tailwind orange (Inbox blue / casual chat green / Background orange; Desktop decision, 2026-08-10).
          icon: key === "background" ? <ActivityIcon className="size-3.5 shrink-0 text-orange-500" /> : undefined,
          rows: byKey.get(key) ?? []
        }))
    )
  }, [rows, selectedId, t])
  // Collapsed state lives only in process memory: it survives leaving Activity and returning, but resets on restart.
  const collapsedGroups = useThreadsUiStore(s => s.activityCollapsedGroups)
  const setCollapsedGroups = useThreadsUiStore(s => s.setActivityCollapsedGroups)
  // Cmd+1 through Cmd+9 and numeric hints follow the flattened group order visible to the user.
  const flatRows = groups.flatMap(group => group.rows)

  // Cmd+1 through Cmd+9 jump to the Nth row in ascending order; number hints appear only on the first nine rows.
  const cmdHeld = useCmdHeld()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey) return
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1 || n > 9) return
      const row = flatRows[n - 1]
      if (!row) return
      e.preventDefault()
      onSelect(row.thread)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  })

  const renderActivityRow = (row: (typeof rows)[number]) => {
    const index = flatRows.indexOf(row)
    return (
      <ActivityRow
        key={row.sid}
        thread={row.thread}
        state={row.record.state}
        active={row.sid === selectedId}
        tasks={row.record.tasks}
        onOpen={() => onSelect(row.thread)}
        hint={
          index < 9 && cmdHeld ? (
            <Kbd>{formatShortcutForDisplay(`CommandOrControl+${index + 1}`).join("")}</Kbd>
          ) : undefined
        }
      />
    )
  }

  return (
    <Pane viewportClassName="px-1 py-1">
      <NavigationStack>
        {groups.map(group =>
          group.key === "foreground" ? (
            <NavigationStack key={group.key}>{group.rows.map(renderActivityRow)}</NavigationStack>
          ) : (
            <NavigationGroup
              key={group.key}
              open={!collapsedGroups.has(group.key)}
              onOpenChange={open => {
                const next = new Set(collapsedGroups)
                if (open) next.delete(group.key)
                else next.add(group.key)
                setCollapsedGroups(next)
              }}
              leading={group.icon}
              label={group.label}
              count={group.rows.length}>
              {group.rows.map(renderActivityRow)}
            </NavigationGroup>
          )
        )}
      </NavigationStack>
    </Pane>
  )
}

function ActivityRow({
  thread,
  state,
  active,
  tasks,
  onOpen,
  hint
}: {
  thread: ThreadSummary
  state: RunState
  active: boolean
  /** Running subagent tasks parsed by Runtime, rendered as indented children and removed from updates on completion. */
  tasks: SessionTask[]
  onOpen: () => void
  hint?: React.ReactNode
}) {
  const { t } = useTranslation()
  const title = thread.title ?? t("sidebar.untitled")
  return (
    <>
      <NavigationSessionItem
        data-session-id={thread.sessionId}
        active={active}
        role="button"
        tabIndex={0}
        hoverCard={<ThreadInfoCard thread={thread} />}
        onClick={onOpen}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onOpen()
          }
        }}
        state={state}
        title={title}
        hint={hint}
        actions={
          /* The trailing ✕ stops the session, using the same control as session columns. Runtime finds the agent by session and terminates its process;
             every row in this panel gets this control. */
          <RowStopButton title={t("sidebar.stop")} onStop={() => report(stopSession(thread.sessionId))} />
        }
      />
      {/* Subagent rows align with the title column (11px row inset + 16px icon + 8px gap = 35px).
          They always pulse yellow because Runtime only retains nonterminal tasks, showing what the main agent is doing. */}
      {tasks.map(task => (
        <div
          key={task.id}
          className="flex h-[var(--navigation-row-height)] items-center gap-2 rounded-[10px] ps-10 pe-2 text-xs [corner-shape:superellipse(1.5)]">
          <SessionStateDot state="running" />
          <span className="text-muted-foreground min-w-0 flex-1 truncate" title={task.title}>
            {task.title}
          </span>
        </div>
      ))}
    </>
  )
}
