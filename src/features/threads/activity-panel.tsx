/**
 * ActivityPanel —— ALwith Desktop 的「Activity」面板:Runtime 运行态注册表里的活跃会话,
 * 层级视图(主 agent 行 + 其下在跑的 subagent 子行)。
 *
 * - 主 agent 行 = 会话(与会话列同一行控件),**按时间正序**——正序稳定不跳行
 *   (先来的在上、新会话追加在底;注意力靠灯色表达即可);
 * - subagent 子行 = Runtime 从 ACP 流量解析的在跑任务(终局即移除)——回答「这条会话
 *   黄了半天到底在忙什么 / 还欠几个后台任务没回来」;
 * - **按宿主分组**:前台 = 正在看的那条(不显示组头并始终平铺)→ 后台(其余运行会话)。
 *   点行打开,行尾 ✕ 停止(Runtime 按会话反查 agent 收进程)。
 * 本仓单窗口、无 ALwith.dev:Desktop 的窗口徽标、执行租约(dev 组)、无主行不存在。
 */
import { ActivityIcon } from "lucide-react"
import { useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { SessionRunState, SessionTask } from "@alwith/api"
import { Pane } from "@/components/alwith-ui/pane"
import { RowStopButton } from "@/components/alwith-ui/row-more-menu"
import { SessionStateDot } from "@/components/alwith-ui/session-state-dot"
import { Kbd } from "@/components/ui/kbd"
import type { ThreadSummary } from "@/agent/client"
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

  // 排序键 = 线程的最近更新时间,**正序**(先来的在上,新会话追加在底,像日志一样长);
  // Desktop 用磁盘会话表的创建时间,Codex 的线程列表只给 updatedAt,是最接近的一份;
  // 列表里还没有的会话排最底。
  const updatedAt = useMemo(
    () =>
      new Map(
        threads.map(thread => [thread.sessionId, thread.updatedAt ? new Date(thread.updatedAt).getTime() : Infinity])
      ),
    [threads]
  )
  // 不做本地可见性过滤:Runtime 的 runStates 就是「此刻真有 agent 在跑」的权威表。
  const rows = useMemo(
    () =>
      Object.values(runStates)
        .map(record => ({ sid: record.sessionId, record, thread: threadOf(threads, record) }))
        .sort((a, b) => (updatedAt.get(a.sid) ?? Infinity) - (updatedAt.get(b.sid) ?? Infinity)),
    [runStates, threads, updatedAt]
  )

  // 前台的事实源是"是否真占着可见 Chat 位":本仓单窗口,即当前选中的会话。
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
        // 「后台」组头**常驻**,没有任务显示 0 条——它是一个固定的去处,不该有任务才出现;
        // 前台组空则不渲染
        .filter(key => byKey.has(key) || key === "background")
        .map(key => ({
          key,
          label: key === "background" ? t("sidebar.background") : t("sidebar.foreground"),
          // 后台:tailwind 固定橙(Inbox 蓝 / 随聊绿 / 后台橙,Desktop 2026-08-10 定)
          icon: key === "background" ? <ActivityIcon className="size-3.5 shrink-0 text-orange-500" /> : undefined,
          rows: byKey.get(key) ?? []
        }))
    )
  }, [rows, selectedId, t])
  // 折叠态仅存进程内存:切走 Activity 再回来保持,重启后清空。
  const collapsedGroups = useThreadsUiStore(s => s.activityCollapsedGroups)
  const setCollapsedGroups = useThreadsUiStore(s => s.setActivityCollapsedGroups)
  // ⌘1~9 与序号提示按**分组后的展平顺序**(用户看到的顺序)
  const flatRows = groups.flatMap(group => group.rows)

  // ⌘1~9 跳到第 N 行(正序;数字提示也只标前 9 条)
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
  /** Runtime 解析的在跑 subagent 任务(缩进子行;终局即从推送里消失)。 */
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
          /* 行尾一颗 ✕ = 停止,与会话列同一颗控件。停止 = Runtime 按会话反查 agent 收进程;
             这个面板里每一行都给。 */
          <RowStopButton title={t("sidebar.stop")} onStop={() => report(stopSession(thread.sessionId))} />
        }
      />
      {/* subagent 子行:缩进对齐标题列(行 11px 内缩 + 图标 16 + 缝 8 = 35px),
          恒黄脉动(Runtime 只保留未终局的),回答"主 agent 在忙什么" */}
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
