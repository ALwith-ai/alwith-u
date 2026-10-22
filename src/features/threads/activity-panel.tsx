/**
 * ActivityPanel adapts ALwith Desktop's Activity panel: active sessions from Runtime's run-state registry,
 * shown hierarchically with a main agent row and running subagent rows beneath it.
 *
 * - Main agent row = session, in first-observed order for stable positioning:
 *   older sessions stay above new sessions appended at the bottom; state colors provide the attention cue.
 * - Subagent rows = running tasks parsed by Runtime from ACP traffic and removed on completion, showing what a long-running session
 *   is doing and which background tasks remain outstanding.
 * - Group by host: foreground is the currently viewed session (always flat, with no group header), followed by background running sessions.
 *   Click a row to open it; the trailing stop button closes only that session.
 * Window ownership comes from the client; visibility comes from the chat surface. Clicking a floating row opens it in that window.
 */

import type { SessionRunState, SessionTask } from "@alwith/api"
import { ActivityIcon, AppWindowIcon, ArrowLeftIcon, PictureInPicture2Icon } from "lucide-react"
import { useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import type { ThreadSummary } from "@/agent/client"
import { HoverInfoAction } from "@/components/alwith-ui/hover-info-card"
import { Pane } from "@/components/alwith-ui/pane"
import { RowStopButton } from "@/components/alwith-ui/row-more-menu"
import { SessionStateDot } from "@/components/alwith-ui/session-state-dot"
import { Kbd } from "@/components/ui/kbd"
import { NavigationGroup } from "@/features/layout/components/navigation/navigation-group"
import { NavigationSessionItem } from "@/features/layout/components/navigation/navigation-session-item"
import { NavigationStack } from "@/features/layout/components/navigation/navigation-stack"
import { useCmdHeld } from "@/hooks/use-cmd-held"
import { focusChatSession } from "@/lib/chat-window"
import { useChatWindowSurface } from "@/lib/chat-window-state"
import { stopSession, useApp } from "@/lib/client"
import { isMac } from "@/lib/platform"
import type { RunState } from "@/lib/run-state"
import { displayShortcut } from "@/lib/shortcut-formatter"

import { useActivityOrder } from "./activity-order"
import { activityGroupOf } from "./lib/activity-group"
import { useThreadsUiStore } from "./store"
import { ThreadInfoCard } from "./thread-info-card"
import { useActivityPreview } from "./use-activity-preview"

function report(promise: Promise<unknown>): Promise<void> {
  return promise.then(
    () => {},
    (error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  )
}

/** The thread behind a run state: the listed one, else a summary built from the Runtime's record. */
function threadOf(threads: ThreadSummary[], record: SessionRunState): ThreadSummary {
  return (
    threads.find((thread) => thread.sessionId === record.sessionId) ?? {
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
  const runStates = useApp((state) => state.runStates)
  const threads = useApp((state) => state.threads)
  const chatSurface = useChatWindowSurface()
  const sessionWindows = useApp((state) => state.sessionWindows)
  const draftSessions = useApp((state) => state.draftSessions)

  const order = useActivityOrder((state) => state.ids)
  const rows = useMemo(
    () =>
      order.flatMap((sid) => {
        const record = runStates[sid]
        // The derived order and source can notify React separately; never render a retired row.
        return record && (!record.reusableDraft || draftSessions[sid] !== undefined)
          ? [{ sid, record, thread: threadOf(threads, record) }]
          : []
      }),
    [order, runStates, threads, draftSessions]
  )

  // Foreground means occupying a visible chat surface, including the separate chat window.
  const groups = useMemo(() => {
    const byKey = new Map<string, typeof rows>()
    for (const row of rows) {
      const key = activityGroupOf({
        visible: row.sid === selectedId || (chatSurface.visible && row.sid === chatSurface.sessionId)
      })
      const bucket = byKey.get(key) ?? []
      bucket.push(row)
      byKey.set(key, bucket)
    }
    return (
      ["foreground", "background"]
        // Keep the Background header visible even with zero tasks: it is a permanent destination, not a section that appears only when tasks exist.
        // Omit the foreground group when empty.
        .filter((key) => byKey.has(key) || key === "background")
        .map((key) => ({
          key,
          label: key === "background" ? t("sidebar.background") : t("sidebar.foreground"),
          icon: key === "background" ? <ActivityIcon className="size-3.5 shrink-0 text-muted-foreground" /> : undefined,
          rows: byKey.get(key) ?? []
        }))
    )
  }, [rows, selectedId, chatSurface, t])
  // Collapsed state lives only in process memory: it survives leaving Activity and returning, but resets on restart.
  const collapsedGroups = useThreadsUiStore((s) => s.activityCollapsedGroups)
  const setCollapsedGroups = useThreadsUiStore((s) => s.setActivityCollapsedGroups)
  // Cmd/Ctrl+1 through Cmd/Ctrl+9 and numeric hints follow the flattened group order visible to the user.
  const flatRows = groups.flatMap((group) =>
    group.key === "foreground" || !collapsedGroups.has(group.key) ? group.rows : []
  )

  const openRow = (thread: ThreadSummary): void => {
    if (sessionWindows[thread.sessionId] === "chat") void report(focusChatSession(thread.sessionId))
    else onSelect(thread)
  }

  // Cmd/Ctrl+1 through Cmd/Ctrl+9 jump to the Nth row in ascending order; number hints appear only on the first nine rows.
  const cmdHeld = useCmdHeld()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat || e.shiftKey || e.altKey) return
      if (isMac() ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1 || n > 9) return
      const row = flatRows[n - 1]
      if (!row) return
      e.preventDefault()
      openRow(row.thread)
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
        interruption={row.record.interruption}
        active={row.sid === selectedId}
        tasks={row.record.tasks}
        listeningPorts={row.record.listeningPorts}
        onOpen={() => openRow(row.thread)}
        windowLabel={sessionWindows[row.sid] === "chat" ? "chat" : row.sid === selectedId ? "main" : null}
        onReturnToMain={() => onSelect(row.thread)}
        shortcut={index < 9 ? `CommandOrControl+${index + 1}` : undefined}
        hint={index < 9 && cmdHeld ? <Kbd>{displayShortcut(`CommandOrControl+${index + 1}`)}</Kbd> : undefined}
      />
    )
  }

  return (
    <Pane className="thread-sidebar-scroll" viewportClassName="ps-2 pe-0 pb-1">
      <NavigationStack>
        {groups.map((group) =>
          group.key === "foreground" ? (
            <NavigationStack key={group.key}>{group.rows.map(renderActivityRow)}</NavigationStack>
          ) : (
            <NavigationGroup
              key={group.key}
              open={!collapsedGroups.has(group.key)}
              onOpenChange={(open) => {
                const next = new Set(collapsedGroups)
                if (open) next.delete(group.key)
                else next.add(group.key)
                setCollapsedGroups(next)
              }}
              leading={group.icon}
              label={group.label}
              count={group.rows.length}
            >
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
  interruption,
  active,
  tasks,
  listeningPorts,
  windowLabel,
  onReturnToMain,
  onOpen,
  hint,
  shortcut
}: {
  thread: ThreadSummary
  state: RunState
  interruption: string | null
  active: boolean
  /** Running subagent tasks parsed by Runtime, rendered as indented children and removed from updates on completion. */
  tasks: SessionTask[]
  listeningPorts: number[]
  windowLabel: "main" | "chat" | null
  onReturnToMain: () => void
  onOpen: () => void
  hint?: React.ReactNode
  shortcut?: string
}) {
  const { t } = useTranslation()
  const title = thread.title ?? t("sidebar.untitled")
  const preview = useActivityPreview(thread.sessionId, state)
  return (
    <>
      <NavigationSessionItem
        data-session-id={thread.sessionId}
        active={active}
        role="button"
        tabIndex={0}
        hoverCard={
          <ThreadInfoCard
            thread={thread}
            shortcut={shortcut}
            actions={
              windowLabel === "chat" ? (
                <HoverInfoAction
                  icon={<ArrowLeftIcon />}
                  label={t("chatWindow.returnToMain")}
                  onClick={onReturnToMain}
                />
              ) : undefined
            }
          />
        }
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onOpen()
          }
        }}
        state={state}
        interruption={interruption}
        title={title}
        preview={preview}
        listeningPorts={listeningPorts}
        accessory={
          windowLabel === null ? undefined : (
            <span
              role="img"
              aria-label={t(windowLabel === "chat" ? "navigation.chatWindow" : "navigation.mainWindow", {
                ns: "common"
              })}
              title={t(windowLabel === "chat" ? "navigation.chatWindow" : "navigation.mainWindow", { ns: "common" })}
            >
              {windowLabel === "chat" ? (
                <PictureInPicture2Icon className="size-3.5 text-muted-foreground" />
              ) : (
                <AppWindowIcon className="size-3.5 text-muted-foreground" />
              )}
            </span>
          )
        }
        hint={hint}
        actions={
          /* Session columns and activity rows close by session ID without stopping the shared agent. */
          <RowStopButton title={t("sidebar.stop")} onStop={() => report(stopSession(thread.sessionId))} />
        }
      />
      {/* Branch lines connect running tasks to their session; Runtime removes terminal tasks. */}
      {tasks.map((task) => (
        <div
          key={task.id}
          className="relative ms-4 flex min-h-7 items-center gap-2 border-s border-border/60 py-1 ps-4 pe-2 text-xs before:absolute before:start-0 before:top-3.5 before:w-2 before:border-t before:border-border/60"
        >
          <SessionStateDot state="running" />
          <span className="min-w-0 flex-1 truncate leading-5 text-muted-foreground" title={task.title}>
            {task.title}
          </span>
        </div>
      ))}
    </>
  )
}
