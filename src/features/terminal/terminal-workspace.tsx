import { createTabController, type TabController } from "@alwith/module-tabs/core"
import { TabActionButton, TabStrip } from "@alwith/module-tabs/react"
import type { TerminalSnapshot } from "@alwith/module-terminal"
import { terminalClient } from "@alwith/module-terminal/tauri"
import { isTauri } from "@tauri-apps/api/core"
import { homeDir } from "@tauri-apps/api/path"
import { getCurrentWindow } from "@tauri-apps/api/window"
import "@alwith/module-tabs/styles.css"
import { TerminalIcon, XIcon } from "lucide-react"
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { ContextMenuItem } from "@/components/ui/context-menu"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { useWorkspace } from "@/features/workspace/context"
import { useHostDialog } from "@/features/workspace/host-dialog"
import { displayShortcut } from "@/lib/shortcut-formatter"
import { text } from "@/lib/text"

import { openTerminalLink } from "./open-link"
import { rememberTerminalViews, restoreTerminalViews } from "./view-preferences"

const TerminalView = lazy(async () => {
  await import("@alwith/module-terminal/styles.css")
  return { default: (await import("@alwith/module-terminal/react")).TerminalView }
})
function report(error: unknown) {
  toast.error(text(error))
}
/** Native build capability, including embedded frontend development candidates. */
export function useTerminalViewAvailable() {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    void terminalClient
      .capabilities()
      .then((capabilities) => {
        if (!disposed) setAvailable(capabilities.interactiveView)
      })
      .catch(report)
    return () => {
      disposed = true
    }
  }, [])
  return available
}
export function TerminalWorkspaceMenuItem() {
  const available = useTerminalViewAvailable(),
    workspace = useWorkspace(),
    { t } = useTranslation()
  if (!available || !workspace?.openPane) return null
  return (
    <DropdownMenuItem
      className="whitespace-nowrap"
      onClick={() => {
        workspace.openPane?.("terminal")
      }}
    >
      <TerminalIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1">{t("terminal.open")}</span>
      <Kbd className="ms-auto shrink-0 bg-muted px-1.5">{displayShortcut("CommandOrControl+J")}</Kbd>
    </DropdownMenuItem>
  )
}
export function TerminalWorkspacePane({
  sessionId,
  cwd,
  onClose
}: {
  sessionId: string
  cwd: string | null
  onClose: () => void
}) {
  const available = useTerminalViewAvailable(),
    { t } = useTranslation(),
    { resolvedTheme } = useTheme()
  const [entries, setEntries] = useState<TerminalSnapshot[]>([]),
    [active, setActive] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [search, setSearch] = useState(""),
    [transfer, setTransfer] = useState<{ terminalId: string; from: string } | null>(null)
  const { ask, dialog } = useHostDialog()
  const lifecycle = useMemo(() => ({ sessionId, revision: 0, closing: 0 }), [sessionId])
  const entriesRef = useRef(entries)
  const searchFocus = useRef<HTMLElement | null>(null)
  entriesRef.current = entries
  const readTerminals = useCallback(async () => {
    if (lifecycle.closing) return null
    const revision = lifecycle.revision
    try {
      const result = await Promise.all([terminalClient.list(sessionId), terminalClient.snapshot(sessionId)])
      return lifecycle.revision === revision ? result : null
    } catch (error) {
      if (lifecycle.revision !== revision) return null
      throw error
    }
  }, [sessionId, lifecycle])
  const refresh = useCallback(async () => {
    const result = await readTerminals()
    if (!result) return
    const [next, nativeActive] = result
    const selected = nativeActive?.terminalId ?? next.at(-1)?.terminalId ?? null
    setEntries(next)
    setActive((id) => (next.some((entry) => entry.terminalId === id) ? id : selected))
    if (selected && !nativeActive) await terminalClient.activate(sessionId, selected)
  }, [sessionId, readTerminals])
  useEffect(() => {
    if (!available) return
    let disposed = false,
      initialized = false
    const run = async () => {
      if (!initialized) return
      const result = await readTerminals()
      if (!disposed && result) {
        const [next, nativeActive] = result
        setEntries(next)
        setActive((id) =>
          next.some((entry) => entry.terminalId === id)
            ? id
            : (nativeActive?.terminalId ?? next.at(-1)?.terminalId ?? null)
        )
      }
    }
    void (async () => {
      const original = await terminalClient.snapshot(sessionId)
      const restored = await restoreTerminalViews(sessionId)
      const saved = restored ?? original?.terminalId
      if (disposed) return
      if (saved) {
        const entries = await terminalClient.list(sessionId)
        if (entries.some((entry) => entry.terminalId === saved)) {
          await terminalClient.activate(sessionId, saved)
          if (!disposed) setActive(saved)
        }
      }
      const entries = await terminalClient.list(sessionId)
      if (entries.length === 0) {
        const created = await terminalClient.register({ sessionId, cwd: cwd ?? (await homeDir()) })
        if (!disposed) setActive(created.terminalId)
        await rememberTerminalViews(sessionId, created.terminalId)
      }
      initialized = true
      await run()
    })().catch(report)
    const timer = setInterval(() => {
      void run().catch(report)
    }, 500)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [available, sessionId, cwd, readTerminals])
  const openLink = useCallback(
    (url: string) => {
      void openTerminalLink(sessionId, url).catch(report)
    },
    [sessionId]
  )
  const current = entries.find((entry) => entry.terminalId === active)
  const start = async () => {
    setLoading(true)
    try {
      const entry = await terminalClient.register({ sessionId, cwd: cwd ?? (await homeDir()) })
      setActive(entry.terminalId)
      await refresh()
      await rememberTerminalViews(sessionId, entry.terminalId)
    } catch (error) {
      report(error)
    } finally {
      setLoading(false)
    }
  }
  const select = useCallback(
    (id: string) => {
      setActive(id)
      void terminalClient
        .activate(sessionId, id)
        .then(() => rememberTerminalViews(sessionId, id))
        .catch(report)
    },
    [sessionId]
  )
  const tabs = useMemo(() => {
    const state = createTabController({
      beforeClose: async (tab) => {
        const entry = entriesRef.current.find((entry) => entry.terminalId === tab.id)
        if (!entry) throw new Error(`Unknown terminal: ${tab.id}`)
        lifecycle.closing += 1
        lifecycle.revision += 1
        try {
          await terminalClient.close(entry)
          return true
        } finally {
          lifecycle.closing -= 1
          lifecycle.revision += 1
        }
      }
    })
    const close = async (id: string) => {
      if (!(await state.requestClose(id))) return false
      const next = state.getSnapshot().activeId
      setEntries((entries) => entries.filter((entry) => entry.terminalId !== id))
      setActive(next)
      if (next) await terminalClient.activate(sessionId, next)
      await rememberTerminalViews(sessionId, next)
      return true
    }
    const controller: TabController = {
      ...state,
      activate(id) {
        state.activate(id)
        select(id)
      },
      requestClose: close,
      async requestCloseMany(ids) {
        for (const id of ids) {
          if (state.getSnapshot().tabs.some((tab) => tab.id === id) && !(await close(id))) return false
        }
        return true
      }
    }
    return { state, controller }
  }, [sessionId, select, lifecycle])
  useEffect(() => {
    const previous = tabs.state.getSnapshot().tabs
    const order = new Map(previous.map((tab, index) => [tab.id, index]))
    tabs.state.replace({
      tabs: entries
        .map((entry) => ({
          id: entry.terminalId,
          title: entry.title,
          tooltip: entry.cwd,
          transient: false,
          dirty: false,
          closable: entry.interactive
        }))
        .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity)),
      activeId: active
    })
  }, [tabs, entries, active])
  const rename = async (id: string) => {
    const entry = entriesRef.current.find((entry) => entry.terminalId === id)
    if (!entry) throw new Error(`Unknown terminal: ${id}`)
    const title = await ask({
      title: t("terminal.rename"),
      detail: entry.cwd,
      initial: entry.title,
      choices: [{ label: t("workspace.save"), value: "save" }]
    })
    if (title?.trim() && title.trim() !== entry.title) {
      await terminalClient.rename(entry, title.trim())
      await refresh()
      await rememberTerminalViews(sessionId, id)
    }
  }
  const ownerWindow = getCurrentWindow().label
  const sourceWindow = current?.viewOwnerWindow ?? current?.ownerWindow
  const needsTransfer =
    sourceWindow !== null &&
    sourceWindow !== undefined &&
    sourceWindow !== ownerWindow &&
    transfer?.terminalId !== current?.terminalId
  if (!available) return null
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      data-terminal-workspace
      onKeyDownCapture={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
          event.preventDefault()
          event.stopPropagation()
          if (!searchOpen)
            searchFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          setSearchOpen(true)
        } else if (event.key === "Escape" && searchOpen) {
          event.preventDefault()
          event.stopPropagation()
          setSearchOpen(false)
          setSearch("")
          searchFocus.current?.focus()
        }
      }}
    >
      <TabStrip
        controller={tabs.controller}
        prefix="terminal"
        labels={{
          newTab: t("terminal.new"),
          close: t("terminal.close"),
          closeOthers: t("workspace.closeOthers"),
          closeRight: t("workspace.closeRight"),
          closeSaved: t("workspace.closeSaved"),
          closeAll: t("workspace.closeAll")
        }}
        renderIcon={() => <TerminalIcon className="size-4" />}
        renderContextMenu={(tab) => (
          <ContextMenuItem
            onClick={() => {
              void rename(tab.id).catch(report)
            }}
          >
            {t("terminal.rename")}
          </ContextMenuItem>
        )}
        newTabAction={{
          label: t("terminal.new"),
          onInvoke: () => {
            if (!loading) void start()
          }
        }}
        trailing={
          <TabActionButton title={t("terminal.hide")} aria-label={t("terminal.hide")} onClick={onClose}>
            <XIcon className="size-4" />
          </TabActionButton>
        }
        onError={report}
      />
      {searchOpen && (
        <Input
          autoFocus
          className="m-2 h-7 w-auto"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label={t("terminal.search")}
          placeholder={t("terminal.search")}
        />
      )}
      {current ? (
        <div
          role="tabpanel"
          id={`terminal-panel-${current.terminalId}`}
          aria-labelledby={`terminal-tab-${current.terminalId}`}
          className="flex min-h-0 flex-1 flex-col"
        >
          {current.error && (
            <div role="alert" className="px-3 text-sm text-destructive">
              {current.error}
            </div>
          )}
          <div className="m-3 min-h-0 min-w-0 flex-1">
            <Suspense fallback={null}>
              {needsTransfer ? (
                <Button onClick={() => setTransfer({ terminalId: current.terminalId, from: sourceWindow })}>
                  {t("terminal.moveHere")}
                </Button>
              ) : (
                <TerminalView
                  client={terminalClient}
                  snapshot={current}
                  searchTerm={search}
                  transferFrom={transfer?.terminalId === current.terminalId ? transfer.from : undefined}
                  dark={resolvedTheme === "dark"}
                  onOpenLink={openLink}
                  onError={report}
                />
              )}
            </Suspense>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <Button
            disabled={loading}
            onClick={() => {
              void start()
            }}
          >
            {t("terminal.new")}
          </Button>
        </div>
      )}
      {dialog}
    </div>
  )
}
