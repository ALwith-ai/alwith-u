import { useDesktopCanvas, useDesktopZoom } from "@alwith/module-desktop-shell/react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { revealItemsInDir } from "@tauri-apps/plugin-opener"
import i18n from "i18next"
import { Download, Globe, Maximize2, Minimize2, Plus, Volume2, VolumeX, X } from "lucide-react"
import { Fragment, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useStore } from "zustand"

import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCanvasPaneVisible } from "@/features/layout/use-canvas-pane-visible"
import { cn } from "@/lib/utils"

import { BrowserPane, type BrowserPaneHandle, type Guest } from "./browser-pane"
import { type BrowserCommand, isPaneCommand, keyCommand } from "./commands"
import { clearDownloads, downloadStore, recordDownload } from "./downloads"
import { retitle, visit } from "./library"
import type { PreviewRequest } from "./preview-request"
import { groupEdge, TabGroupChip } from "./tab-group-chip"
import { addSessionTab, groupColors, joinGroup, leaveGroup, settleGroup, type TabGroup, usedGroups } from "./tab-groups"
import { insertAfter, moveTab, moveTo, pinTab } from "./tab-order"
import { TabSearch } from "./tab-search"
import { loadTabs, saveTabs, type TabHistory } from "./tab-store"

const BrowserQuickChat = lazy(async () => ({ default: (await import("./browser-quick-chat")).BrowserQuickChat }))

interface Tab {
  id: string
  title: string
  label?: string
  request?: PreviewRequest
  adopted?: Guest
  /** Where a restored or reopened tab starts. */
  initialUrl?: string
  /** The session history a restored, reopened or duplicated tab starts with. */
  initialHistory?: TabHistory
  url?: string
  /** The tab's session history as its browser last reported it. */
  history?: TabHistory
  loading?: boolean
  favicon?: string | null
  fullscreen?: boolean
  /** Nothing of this tab is kept: no history, no saved tab, and a profile that ends with it. */
  private?: boolean
  /** The group the tab stands in, if any. */
  group?: string
  /** Kept at the head of the strip, shown by its icon alone and not closed by a stray press. */
  pinned?: boolean
  muted?: boolean
  /** Being heard right now; the browser says so, and it is never saved. */
  audible?: boolean
}
interface State {
  tabs: Tab[]
  selected: string
  /** Tabs whose guest exists. A restored tab loads when first shown, not at startup. */
  opened: string[]
  closed: { url: string; title: string; history?: TabHistory }[]
  /** Groups of tabs; one with no tab left is no longer shown or kept. */
  groups: TabGroup[]
}
interface DownloadItem {
  id: number
  label: string
  url: string
  path: string
  received: number
  total: number
  state: "progress" | "finished" | "canceled" | "failed"
}
const fileName = (item: Pick<DownloadItem, "path" | "url">) =>
  item.path.split("/").pop() || new URL(item.url).pathname.split("/").pop() || item.url
const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`
const bound = (tab: Tab) => Boolean(tab.request?.sessionId ?? tab.adopted?.sessionId)
const closedLimit = 25

function initialState(request?: PreviewRequest): State {
  const first: Tab | undefined = request && {
    id: request.id,
    title: new URL(request.url).hostname,
    request
  }
  const stored = loadTabs()
  const groups = (stored?.groups ?? []).map((group): TabGroup => ({
    ...group,
    id: crypto.randomUUID()
  }))
  const saved = (stored?.tabs ?? []).map((tab): Tab => ({
    id: crypto.randomUUID(),
    // A tab with no page yet has no title of its own; one saved under the old wording is such a tab.
    title: tab.title === "新标签页" ? "" : tab.title,
    initialUrl: tab.url,
    initialHistory: tab.history,
    url: tab.url,
    history: tab.history,
    pinned: tab.pinned,
    group: tab.group === undefined ? undefined : groups[tab.group]?.id
  }))
  const restoredSelection = saved[stored?.selected ?? 0]
  const grouped = first ? addSessionTab(saved, groups, first, request?.sessionId) : { tabs: saved, groups }
  const tabs = grouped.tabs
  if (tabs.length === 0) tabs.push({ id: crypto.randomUUID(), title: "" })
  const selected = (first ?? restoredSelection ?? tabs[0]!).id
  const shown = tabs.find((tab) => tab.id === selected)?.group
  return {
    tabs,
    selected,
    opened: [selected],
    closed: [],
    // The tab in front is never put away.
    groups: grouped.groups.map((group) => (group.id === shown ? { ...group, collapsed: false } : group))
  }
}
/** Each tab keeps its real CEF surface mounted; selection changes only visibility. */
export function BrowserWorkspace({
  request,
  chatLinks,
  onConsumeChatLinks,
  sessionTitles,
  revealRequest = 0,
  active,
  maximized,
  onMaximize,
  onClose
}: {
  request?: PreviewRequest
  chatLinks?: readonly { id: string; url: string }[]
  onConsumeChatLinks?: (ids: readonly string[]) => void
  sessionTitles?: Readonly<Record<string, string | null | undefined>>
  revealRequest?: number
  active: boolean
  maximized: boolean
  onMaximize: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [state, setState] = useState(() => initialState(request))
  const browserOnPage = useCanvasPaneVisible("browser")
  const navigate = useDesktopCanvas()?.navigate
  // Retained panes can be open on another screen; every explicit reveal must navigate to this one.
  useEffect(() => {
    if (active) navigate?.("browser")
  }, [active, maximized, revealRequest, navigate])
  // The one interface zoom, kept by the desktop shell; pages follow it.
  const desktopZoom = useDesktopZoom()
  const { tabs, selected, opened, closed } = state
  const tabList = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const list = tabList.current
    if (!active || !list) return
    const reveal = () => {
      const tab = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      if (!tab || !list.clientWidth) return
      const right = tab.offsetLeft + tab.offsetWidth
      const chip = tab.previousElementSibling
      // Keep the leading group name visible with its first tab when they fit together.
      const left =
        chip instanceof HTMLElement &&
        tab.dataset.browserTabGroupMember !== undefined &&
        chip.dataset.browserTabGroup === tab.dataset.browserTabGroupMember &&
        right - chip.offsetLeft <= list.clientWidth
          ? chip.offsetLeft
          : tab.offsetLeft
      if (left < list.scrollLeft) list.scrollLeft = left
      else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth
    }
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(list)
    return () => observer.disconnect()
  }, [active, selected])
  useEffect(() => {
    const list = tabList.current
    if (!list) return
    const scroll = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || list.scrollWidth <= list.clientWidth) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? list.clientWidth
            : 1
      list.scrollLeft += delta * unit
      event.preventDefault()
    }
    list.addEventListener("wheel", scroll, { passive: false })
    return () => list.removeEventListener("wheel", scroll)
  }, [])
  const groups = usedGroups(state.groups, tabs).map((group) => ({
    ...group,
    title: group.sessionId ? sessionTitles?.[group.sessionId] || group.title : group.title
  }))
  const [searching, setSearching] = useState(false)
  // Commands arrive from native events; they act on the tabs as they are now.
  const current = useRef(state)
  current.current = state
  const setTabs = (update: (tabs: Tab[]) => Tab[]) => setState((state) => ({ ...state, tabs: update(state.tabs) }))
  const select = (state: State, id: string): State => {
    const tab = state.tabs.find((tab) => tab.id === id)
    if (!tab) return state
    return {
      ...state,
      selected: id,
      opened: state.opened.includes(id) ? state.opened : [...state.opened, id],
      // The tab in front is never put away: its group opens for it.
      groups: state.groups.some((group) => group.id === tab.group && group.collapsed)
        ? state.groups.map((group) => (group.id === tab.group ? { ...group, collapsed: false } : group))
        : state.groups
    }
  }
  const setGroup = (id: string, change: Partial<TabGroup>) =>
    setState((state) => ({
      ...state,
      groups: state.groups.map((group) => (group.id === id ? { ...group, ...change } : group))
    }))
  // Putting a group away moves the user to the nearest tab outside it; with nowhere to go it stays open.
  const toggleGroup = (id: string) =>
    setState((state) => {
      const group = state.groups.find((group) => group.id === id)
      if (!group) return state
      const groups = state.groups.map((entry) => (entry.id === id ? { ...entry, collapsed: !entry.collapsed } : entry))
      const index = state.tabs.findIndex((tab) => tab.id === state.selected)
      if (group.collapsed || state.tabs[index]?.group !== id) return { ...state, groups }
      const outside =
        state.tabs.slice(index).find((tab) => tab.group !== id) ??
        state.tabs.slice(0, index).findLast((tab) => tab.group !== id)
      return outside ? { ...select(state, outside.id), groups } : state
    })
  const setSelected = (id: string) => setState((state) => select(state, id))
  const add = (tab: Tab) =>
    setState((state) =>
      select(
        {
          ...state,
          ...addSessionTab(state.tabs, state.groups, tab, tab.request?.sessionId ?? tab.adopted?.sessionId)
        },
        tab.id
      )
    )
  const [controls, setControls] = useState<Record<string, { sessionId: string; stopping: boolean }>>({})
  const release = (tab: Tab) => {
    if (!tab.label) return
    void invoke("web_automation_takeover", { target: tab.label }).catch((error: unknown) => toast.error(String(error)))
  }
  const panes = useRef(new Map<string, BrowserPaneHandle>())
  // The browser is told where each tab is in the strip and whether it is pinned: extensions ask it, and only
  // this strip knows. The tab that was moved is named apart from those that made room for it.
  const movedLabel = useRef<string | undefined>(undefined)
  const reported = useRef(new Map<string, string>())
  useEffect(() => {
    const moved = movedLabel.current
    movedLabel.current = undefined
    const live = new Set<string>()
    tabs.forEach((tab, index) => {
      if (!tab.label) return
      live.add(tab.label)
      const place = `${index}:${Boolean(tab.pinned)}`
      if (reported.current.get(tab.label) === place) return
      reported.current.set(tab.label, place)
      void invoke("cef_guest_tab_state", {
        label: tab.label,
        index,
        pinned: Boolean(tab.pinned),
        moved: tab.label === moved
      }).catch(() => {})
    })
    for (const label of reported.current.keys()) if (!live.has(label)) reported.current.delete(label)
  }, [tabs])
  // The tab being dragged along the strip.
  const dragged = useRef<string | undefined>(undefined)
  useEffect(() => {
    saveTabs(
      tabs.map((tab) => ({
        url: tab.url,
        title: tab.title,
        bound: bound(tab) || Boolean(tab.private),
        pinned: tab.pinned,
        history: tab.history,
        group: tab.group
      })),
      tabs.findIndex((tab) => tab.id === selected),
      localStorage,
      state.groups
    )
  }, [tabs, selected, state.groups])
  // Restore suspended pages only when the browser chat explicitly asks to discover tabs.
  const tabRequests = useRef(new Set<string>())
  useEffect(() => {
    const stop = listen<{ id: string }>("browser-prepare-tabs", ({ payload }) => {
      tabRequests.current.add(payload.id)
      setState((state) => ({
        ...state,
        opened: state.tabs.map((tab) => tab.id)
      }))
    })
    void stop.catch((error: unknown) => toast.error(String(error)))
    return () => {
      void stop.then((unlisten) => unlisten()).catch(() => {})
    }
  }, [])
  useEffect(() => {
    if (tabs.some((tab) => !tab.label)) return
    for (const id of tabRequests.current) {
      tabRequests.current.delete(id)
      void invoke("cef_browser_tabs_ready", {
        id,
        tabs: tabs.map((tab) => ({ id: tab.label, title: tab.title, active: tab.id === selected }))
      }).catch((error: unknown) => toast.error(String(error)))
    }
  }, [tabs, opened, selected])
  const lastRequest = useRef(request?.id)
  useEffect(() => {
    if (!request || lastRequest.current === request.id) return
    lastRequest.current = request.id
    add({ id: request.id, title: new URL(request.url).hostname, request })
  }, [request])
  useEffect(() => {
    if (!chatLinks?.length) return
    setState((state) => {
      const tabs = chatLinks
        .filter((link) => !state.tabs.some((tab) => tab.id === link.id))
        .map(({ id, url }): Tab => ({ id, url, initialUrl: url, title: new URL(url).hostname }))
      const last = tabs.at(-1)
      return last ? select({ ...state, tabs: [...state.tabs, ...tabs] }, last.id) : state
    })
    onConsumeChatLinks?.(chatLinks.map((link) => link.id))
  }, [chatLinks, onConsumeChatLinks])
  const close = (match: { id?: string; label?: string }) =>
    setState((state) => {
      const index = state.tabs.findIndex((tab) => (match.id ? tab.id === match.id : tab.label === match.label))
      if (index === -1) return state
      const removed = state.tabs[index]!
      const tabs = state.tabs.filter((tab) => tab.id !== removed.id)
      const next = state.selected === removed.id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? "") : state.selected
      // Only an ordinary page can come back: a conversation's tab is reopened by its conversation.
      const closed =
        !bound(removed) && !removed.private && removed.url && /^https?:\/\//i.test(removed.url)
          ? [
              ...state.closed,
              {
                url: removed.url,
                title: removed.title,
                history: removed.history
              }
            ].slice(-closedLimit)
          : state.closed
      return select(
        {
          ...state,
          tabs,
          closed,
          selected: next,
          opened: state.opened.filter((id) => id !== removed.id)
        },
        next
      )
    })
  const run = (command: BrowserCommand, from?: string) => {
    const source = from ?? current.current.selected
    if (isPaneCommand(command)) {
      panes.current.get(source)?.run(command)
      return
    }
    if (command === "close-tab") {
      close({ id: source })
      return
    }
    if (command === "search-tabs") {
      setSearching(true)
      return
    }
    if (command === "zoom-in" || command === "zoom-out" || command === "zoom-reset") {
      // The one interface zoom; pages follow it below.
      const zoom =
        command === "zoom-in" ? desktopZoom.zoomIn : command === "zoom-out" ? desktopZoom.zoomOut : desktopZoom.reset
      void zoom().catch((error: unknown) => toast.error(String(error)))
      return
    }
    setState((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === source)
      switch (command) {
        case "new-tab":
        case "new-private-tab": {
          const created: Tab = {
            id: crypto.randomUUID(),
            title: "",
            private: command === "new-private-tab"
          }
          return select({ ...state, tabs: [...state.tabs, created] }, created.id)
        }
        case "reopen-tab": {
          const last = state.closed.at(-1)
          if (!last) return state
          const reopened: Tab = {
            id: crypto.randomUUID(),
            title: last.title,
            initialUrl: last.url,
            initialHistory: last.history,
            url: last.url,
            history: last.history
          }
          return select(
            {
              ...state,
              tabs: [...state.tabs, reopened],
              closed: state.closed.slice(0, -1)
            },
            reopened.id
          )
        }
        case "previous-tab":
        case "next-tab": {
          if (index === -1) return state
          const step = command === "next-tab" ? 1 : state.tabs.length - 1
          return select(state, state.tabs[(index + step) % state.tabs.length]!.id)
        }
        case "tab-last":
          return select(state, state.tabs.at(-1)?.id ?? "")
        default:
          return select(state, state.tabs[Number(command.slice(4)) - 1]?.id ?? "")
      }
    })
  }
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const downloaded = useStore(downloadStore)
  const downloadStates = useRef(new Map<number, DownloadItem["state"]>())
  const runCommand = useRef(run)
  runCommand.current = run
  // A page in fullscreen takes the whole display, like in any browser; the window returns to how it was.
  const pageFullscreen = tabs.some((tab) => tab.fullscreen)
  const windowWasFullscreen = useRef<boolean | null>(null)
  useEffect(() => {
    const report = (error: unknown) => toast.error(String(error))
    if (pageFullscreen) {
      const window = getCurrentWindow()
      void window
        .isFullscreen()
        .then((already) => {
          windowWasFullscreen.current = already
          if (!already) return window.setFullscreen(true)
        })
        .catch(report)
    } else if (windowWasFullscreen.current !== null) {
      const restore = windowWasFullscreen.current
      windowWasFullscreen.current = null
      if (!restore) void getCurrentWindow().setFullscreen(false).catch(report)
    }
  }, [pageFullscreen])
  // Extensions are told when the window comes to the front or leaves it: they ask, and only the application
  // knows. Any ordinary tab carries the word to the browser.
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      const label = current.current.tabs.find((tab) => tab.label && !tab.private)?.label
      if (label) void invoke("cef_guest_window_focus", { label, focused }).catch(() => {})
    })
    return () => void unlisten.then((stop) => stop())
  }, [])
  // Pages follow the application's interface zoom instead of keeping a second one.
  const zoomLevel = desktopZoom.level
  useEffect(() => {
    void invoke("cef_set_guest_zoom", { scaleFactor: zoomLevel }).catch((error: unknown) => toast.error(String(error)))
  }, [zoomLevel])
  useEffect(() => {
    let disposed = false
    const focus = listen<{ label: string }>("browser-tab-focus", ({ payload }) => {
      if (!disposed)
        setState((state) => {
          const tab = state.tabs.find((tab) => tab.label === payload.label)
          return tab ? { ...state, selected: tab.id } : state
        })
    })
    // An extension asks for a tab to be moved or pinned; the strip is the user's and does it by its own rules.
    const move = listen<{ label: string; index: number }>("browser-tab-move", ({ payload }) => {
      if (disposed) return
      movedLabel.current = payload.label
      setState((state) => {
        const tab = state.tabs.find((tab) => tab.label === payload.label)
        return tab
          ? {
              ...state,
              tabs: settleGroup(moveTo(state.tabs, tab.id, payload.index), tab.id)
            }
          : state
      })
    })
    const pin = listen<{ label: string; pinned: boolean }>("browser-tab-pin", ({ payload }) => {
      if (disposed) return
      setState((state) => {
        const tab = state.tabs.find((tab) => tab.label === payload.label)
        return tab ? { ...state, tabs: pinTab(state.tabs, tab.id, payload.pinned) } : state
      })
    })
    // The browser says so whoever silenced the tab: the user here, or an extension.
    const muted = listen<{ label: string; muted: boolean }>("browser-tab-muted", ({ payload }) => {
      setTabs((tabs) => tabs.map((tab) => (tab.label === payload.label ? { ...tab, muted: payload.muted } : tab)))
    })
    const audible = listen<{ label: string; audible: boolean }>("browser-tab-audible", ({ payload }) => {
      setTabs((tabs) => tabs.map((tab) => (tab.label === payload.label ? { ...tab, audible: payload.audible } : tab)))
    })
    const closed = listen<{ label: string }>("browser-tab-closed", ({ payload }) => {
      if (!disposed) close({ label: payload.label })
    })
    const refreshControls = () => {
      void invoke<Record<string, { sessionId: string; stopping: boolean }>>("web_automation_controls")
        .then((value) => {
          if (!disposed) setControls(value)
        })
        .catch((error: unknown) => {
          if (!disposed) toast.error(String(error))
        })
    }
    const released = listen("browser-control-changed", refreshControls)
    void released.then(refreshControls).catch((error: unknown) => {
      if (!disposed) toast.error(String(error))
    })
    const popup = listen<Guest>("browser-popup-created", ({ payload }) => {
      if (!disposed)
        setState((state) =>
          state.tabs.some((tab) => tab.label === payload.label)
            ? state
            : select(
                {
                  ...state,
                  ...addSessionTab(
                    state.tabs,
                    state.groups,
                    {
                      id: payload.label,
                      label: payload.label,
                      title: "",
                      adopted: payload
                    },
                    payload.sessionId
                  )
                },
                payload.label
              )
        )
    })
    // Pages the browser opens on its own account, for an extension: tabs of the user's like any other. They
    // wait until taken, so one asked for while this pane was not showing is opened when it is.
    const takeRequested = () =>
      void invoke<{ url: string; background: boolean }[] | undefined>("cef_take_tab_requests")
        .then((requests) => {
          if (disposed || !requests?.length) return
          const created = requests.map(({ url }): Tab => ({
            id: crypto.randomUUID(),
            title: new URL(url).hostname,
            initialUrl: url,
            url
          }))
          // One asked for behind the others loads there; the user stays where they are.
          const front = created.findLast((_, index) => !requests[index]!.background)
          setState((state) => {
            const next = {
              ...state,
              tabs: [...state.tabs, ...created],
              opened: [...state.opened, ...created.map((tab) => tab.id)]
            }
            return front ? select(next, front.id) : next
          })
        })
        .catch((error: unknown) => toast.error(String(error)))
    const requested = listen("browser-open-tab", takeRequested)
    takeRequested()
    // A chord pressed inside a page: the native guest claimed it and names the tab it came from.
    const shortcut = listen<{ label: string; command: BrowserCommand }>("browser-shortcut", ({ payload }) => {
      if (disposed) return
      const source = current.current.tabs.find((tab) => tab.label === payload.label)
      if (source) runCommand.current(payload.command, source.id)
    })
    // Files land in the Downloads folder; the user sees them arrive and is told how each ended.
    const download = listen<DownloadItem>("browser-download", ({ payload }) => {
      if (disposed) return
      const previous = downloadStates.current.get(payload.id)
      downloadStates.current.set(payload.id, payload.state)
      // Only a running download is live; once ended it is a record that outlasts this run.
      setDownloads((items) =>
        payload.state !== "progress"
          ? items.filter((item) => item.id !== payload.id)
          : items.some((item) => item.id === payload.id)
            ? items.map((item) => (item.id === payload.id ? payload : item))
            : [payload, ...items]
      )
      // The end of a download is recorded and announced once, however many updates repeat it.
      if (previous === payload.state || payload.state === "progress") return
      recordDownload({
        url: payload.url,
        path: payload.path,
        state: payload.state,
        at: Date.now()
      })
      if (payload.state === "canceled") return
      const name = fileName(payload)
      if (payload.state === "failed") toast.error(i18n.t("browser.downloadFailed", { name }))
      else
        toast.success(i18n.t("browser.downloaded", { name }), {
          action: payload.path
            ? {
                label: i18n.t("browser.reveal"),
                onClick: () =>
                  void revealItemsInDir([payload.path]).catch((error: unknown) => toast.error(String(error)))
              }
            : undefined
        })
    })
    const subscriptions = [focus, move, pin, muted, audible, closed, released, popup, requested, shortcut, download]
    for (const pending of subscriptions) void pending.catch((error) => toast.error(String(error)))
    return () => {
      disposed = true
      for (const pending of subscriptions) void pending.then((unlisten) => unlisten()).catch(() => {})
    }
  }, [])
  return (
    <section
      aria-label={t("browser.workspace")}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      onKeyDown={(event) => {
        // The same chords while focus is in the browser's own chrome rather than a page.
        if ((event.target as Element).closest("[data-browser-quick-chat]")) return
        const command = keyCommand(event.nativeEvent)
        if (!command) return
        event.preventDefault()
        event.stopPropagation()
        run(command)
      }}
    >
      <header className="flex h-10 shrink-0 items-end gap-1 bg-muted px-2">
        <Tabs
          className="min-w-0 shrink"
          value={selected}
          onValueChange={(value) => {
            if (typeof value === "string") setSelected(value)
          }}
        >
          <TabsList
            ref={tabList}
            aria-label={t("browser.tabs")}
            className="relative flex h-auto w-auto min-w-0 scrollbar-none! justify-start gap-0.5 overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-none bg-transparent p-0"
          >
            {tabs.map((tab, index) => {
              const group = groups.find((entry) => entry.id === tab.group)
              const firstInGroup = group && tabs[index - 1]?.group !== group.id
              const groupName = group && t("browser.tabGroup", { title: group.title || t("browser.unnamedGroup") })
              const tabTitle = tab.title || t("browser.newTab")
              return (
                <Fragment key={tab.id}>
                  {group && firstInGroup && (
                    <TabGroupChip
                      group={group}
                      onChange={(change) => setGroup(group.id, change)}
                      onToggle={() => toggleGroup(group.id)}
                      onUngroup={() => {
                        if (group.sessionId) {
                          for (const member of tabs) if (member.group === group.id && member.label) release(member)
                        } else
                          setTabs((tabs) =>
                            tabs.map((value) => (value.group === group.id ? { ...value, group: undefined } : value))
                          )
                      }}
                      onClose={() => {
                        for (const member of tabs) if (member.group === group.id) close({ id: member.id })
                      }}
                    />
                  )}
                  {!group?.collapsed && (
                    <ContextMenu>
                      <ContextMenuTrigger
                        render={
                          <TabsTrigger
                            value={tab.id}
                            render={<div />}
                            nativeButton={false}
                            title={[tabTitle, groupName, bound(tab) && t("browser.boundTab")]
                              .filter(Boolean)
                              .join("\n")}
                            aria-description={groupName}
                            data-browser-tab-group-member={group?.id}
                            // A tab as a browser draws it: the one in front is a sheet joined to the toolbar below.
                            className={cn(
                              "group/tab flex h-[34px] items-center justify-start gap-1.5 rounded-t-lg rounded-b-none border-0 px-2.5 pr-1.5 text-xs font-normal text-muted-foreground shadow-none after:hidden hover:text-foreground data-active:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-none dark:data-active:border-transparent dark:data-active:bg-background",
                              // Regular tabs narrow together to a usable minimum before the list scrolls.
                              tab.pinned ? "flex-none px-2.5" : "w-52 min-w-24 flex-[0_1_13rem]",
                              tab.id === selected ? "bg-background" : "hover:bg-background/50",
                              // Balance the top border so grouped titles share the strip's text baseline.
                              group && cn("border-y-2 border-b-transparent", groupEdge[group.color])
                            )}
                            draggable={!bound(tab)}
                            // The middle button closes a tab, as in every browser; a pinned one stays.
                            onAuxClick={(event) => {
                              if (event.button === 1 && !tab.pinned) close({ id: tab.id })
                            }}
                            onDragStart={(event) => {
                              dragged.current = tab.id
                              event.dataTransfer.effectAllowed = "move"
                            }}
                            onDragOver={(event) => {
                              if (!bound(tab) && dragged.current && dragged.current !== tab.id) event.preventDefault()
                            }}
                            onDrop={(event) => {
                              event.preventDefault()
                              if (bound(tab)) return
                              const moved = dragged.current
                              dragged.current = undefined
                              if (moved) {
                                movedLabel.current = current.current.tabs.find((value) => value.id === moved)?.label
                                setState((state) => ({
                                  ...state,
                                  tabs: settleGroup(moveTab(state.tabs, moved, tab.id), moved)
                                }))
                              }
                            }}
                            onDragEnd={() => (dragged.current = undefined)}
                          >
                            {tab.loading ? (
                              <Spinner aria-hidden="true" aria-label={undefined} role="presentation" />
                            ) : tab.favicon ? (
                              <img src={tab.favicon} alt="" className="size-4 shrink-0" />
                            ) : (
                              <Globe aria-hidden="true" />
                            )}
                            {!tab.pinned && <span className="min-w-0 flex-1 truncate text-left">{tabTitle}</span>}
                            {tab.pinned && (
                              <span className="sr-only">
                                {tabTitle} · {t("browser.pinnedTab")}
                              </span>
                            )}
                            {tab.muted ? (
                              <VolumeX aria-label={t("browser.mutedTab")} />
                            ) : (
                              tab.audible && <Volume2 aria-label={t("browser.audibleTab")} />
                            )}
                            {tab.label && controls[tab.label] ? (
                              <span
                                aria-label={t("browser.aiTab")}
                                title={
                                  sessionTitles?.[controls[tab.label]!.sessionId] || controls[tab.label]!.sessionId
                                }
                              >
                                {controls[tab.label]!.stopping ? " · …" : " · AI"}
                              </span>
                            ) : null}
                            {tab.private && (
                              <span aria-label={t("browser.privateTab")} className="min-w-0 truncate">
                                {" · "}
                                {t("browser.private")}
                              </span>
                            )}
                            {!tab.pinned && (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                // Always there on the tab in front; on the others when the pointer or the keyboard reaches them.
                                className={cn(
                                  "size-5 shrink-0 rounded-full",
                                  tab.id !== selected &&
                                    "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100"
                                )}
                                aria-label={t("browser.closeTab", {
                                  title: tabTitle
                                })}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  close({ id: tab.id })
                                }}
                              >
                                <X />
                              </Button>
                            )}
                          </TabsTrigger>
                        }
                      />
                      <ContextMenuContent>
                        <ContextMenuItem
                          disabled={!tab.url || bound(tab)}
                          onClick={() =>
                            setState((state) => {
                              const created: Tab = {
                                id: crypto.randomUUID(),
                                title: tab.title,
                                initialUrl: tab.url,
                                // A private tab's history ends with it.
                                ...(!tab.private && {
                                  initialHistory: tab.history,
                                  history: tab.history
                                }),
                                url: tab.url,
                                private: tab.private
                              }
                              return select(
                                {
                                  ...state,
                                  tabs: insertAfter(state.tabs, tab.id, created)
                                },
                                created.id
                              )
                            })
                          }
                        >
                          {t("browser.duplicateTab")}
                        </ContextMenuItem>
                        <ContextMenuItem
                          disabled={bound(tab)}
                          onClick={() =>
                            setState((state) => ({
                              ...state,
                              // A pinned tab stands at the head of the strip, outside any group.
                              tabs: pinTab(
                                tab.pinned ? state.tabs : leaveGroup(state.tabs, tab.id),
                                tab.id,
                                !tab.pinned
                              )
                            }))
                          }
                        >
                          {t(tab.pinned ? "browser.unpinTab" : "browser.pinTab")}
                        </ContextMenuItem>
                        <ContextMenuItem
                          disabled={!tab.label}
                          onClick={() => {
                            const muted = !tab.muted
                            if (!tab.label) return
                            void invoke("cef_guest_mute", {
                              label: tab.label,
                              muted
                            })
                              .then(() =>
                                setTabs((tabs) =>
                                  tabs.map((value) => (value.id === tab.id ? { ...value, muted } : value))
                                )
                              )
                              .catch((error: unknown) => toast.error(String(error)))
                          }}
                        >
                          {t(tab.muted ? "browser.unmuteTab" : "browser.muteTab")}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          disabled={Boolean(tab.pinned) || bound(tab)}
                          onClick={() =>
                            setState((state) => {
                              const created: TabGroup = {
                                id: crypto.randomUUID(),
                                title: "",
                                // The colour the fewest groups wear.
                                color: groupColors.toSorted(
                                  (a, b) =>
                                    groups.filter((entry) => entry.color === a).length -
                                    groups.filter((entry) => entry.color === b).length
                                )[0]!
                              }
                              return {
                                ...state,
                                groups: [...usedGroups(state.groups, state.tabs), created],
                                tabs: joinGroup(leaveGroup(state.tabs, tab.id), tab.id, created.id)
                              }
                            })
                          }
                        >
                          {t("browser.addToNewGroup")}
                        </ContextMenuItem>
                        {groups
                          .filter((entry) => entry.id !== tab.group && !entry.sessionId)
                          .map((entry) => (
                            <ContextMenuItem
                              key={entry.id}
                              disabled={Boolean(tab.pinned) || bound(tab)}
                              onClick={() => setTabs((tabs) => joinGroup(tabs, tab.id, entry.id))}
                            >
                              {t("browser.addToGroup", {
                                title: entry.title || t("browser.unnamedGroup")
                              })}
                            </ContextMenuItem>
                          ))}
                        {tab.label && controls[tab.label] && (
                          <ContextMenuItem disabled={controls[tab.label]!.stopping} onClick={() => release(tab)}>
                            {t("browser.releaseControl")}
                          </ContextMenuItem>
                        )}
                        {tab.group && !bound(tab) && (
                          <ContextMenuItem onClick={() => setTabs((tabs) => leaveGroup(tabs, tab.id))}>
                            {t("browser.removeFromGroup")}
                          </ContextMenuItem>
                        )}
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => close({ id: tab.id })}>
                          {t("browser.closeTabItem")}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  )}
                </Fragment>
              )
            })}
          </TabsList>
        </Tabs>
        <Button
          variant="ghost"
          size="icon-sm"
          className="mb-1 size-7 shrink-0 rounded-full"
          aria-label={t("browser.newTabButton")}
          onClick={() => run("new-tab")}
        >
          <Plus />
        </Button>
        <TabSearch
          open={searching}
          onOpenChange={setSearching}
          // A private tab is found among the open ones like any other; closed, it left nothing to find.
          tabs={tabs.map((tab) => ({
            id: tab.id,
            title: tab.title,
            url: tab.url
          }))}
          closed={closed}
          onSelect={setSelected}
          onReopen={(index) =>
            setState((state) => {
              const entry = state.closed[index]
              if (!entry) return state
              const reopened: Tab = {
                id: crypto.randomUUID(),
                title: entry.title,
                initialUrl: entry.url,
                initialHistory: entry.history,
                url: entry.url,
                history: entry.history
              }
              return select(
                {
                  ...state,
                  tabs: [...state.tabs, reopened],
                  closed: state.closed.filter((_, at) => at !== index)
                },
                reopened.id
              )
            })
          }
        />
        <div className="flex-1" />
        {downloads.length + downloaded.length > 0 && (
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="mb-1 size-7 shrink-0 rounded-full"
                  aria-label={t("browser.downloadsRunning", {
                    count: downloads.length
                  })}
                />
              }
            >
              <Download />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96">
              <ul aria-label={t("browser.downloads")} className="flex max-h-80 flex-col gap-3 overflow-auto">
                {downloads.map((item) => (
                  <li key={item.id} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm" title={item.url}>
                        {fileName(item)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void invoke("cef_cancel_download", {
                            label: item.label,
                            id: item.id
                          }).catch((error: unknown) => toast.error(String(error)))
                        }
                      >
                        {t("browser.cancel")}
                      </Button>
                    </div>
                    {item.total > 0 ? (
                      <Progress
                        aria-label={t("browser.downloadProgress", {
                          name: fileName(item)
                        })}
                        value={Math.round((item.received / item.total) * 100)}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("browser.received", {
                          size: megabytes(item.received)
                        })}
                      </span>
                    )}
                  </li>
                ))}
                {downloaded.map((item) => (
                  <li key={`${item.at}:${item.path || item.url}`} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm" title={item.url}>
                      {fileName(item)}
                    </span>
                    {item.state === "finished" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void revealItemsInDir([item.path]).catch((error: unknown) => toast.error(String(error)))
                        }
                      >
                        {t("browser.reveal")}
                      </Button>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {t(item.state === "canceled" ? "browser.canceled" : "browser.failed")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {downloaded.length > 0 && (
                <Button variant="ghost" size="sm" className="mt-3" onClick={clearDownloads}>
                  {t("browser.clearDownloads")}
                </Button>
              )}
            </PopoverContent>
          </Popover>
        )}
        <div className="mb-1 flex h-7 shrink-0 items-center gap-1">
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 rounded-full"
            aria-label={t(maximized ? "browser.sideBySide" : "browser.expand")}
            onClick={onMaximize}
          >
            {maximized ? <Minimize2 /> : <Maximize2 />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 rounded-full"
            aria-label={t("browser.hide")}
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </header>
      <div className="relative grid min-h-0 flex-1 grid-cols-1 grid-rows-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            aria-label={tab.title}
            aria-hidden={tab.id !== selected}
            inert={tab.id !== selected}
            className={`col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col${tab.id !== selected ? " invisible" : ""}`}
          >
            {opened.includes(tab.id) && (
              <BrowserPane
                ref={(handle) => {
                  if (handle) panes.current.set(tab.id, handle)
                  else panes.current.delete(tab.id)
                }}
                onGuest={(label) =>
                  setTabs((tabs) => tabs.map((value) => (value.id === tab.id ? { ...value, label } : value)))
                }
                onMeta={(meta) => {
                  // A committed location the tab was not already on is a visit.
                  if (meta.url && meta.url !== tab.url && !tab.private) visit(meta.url, "")
                  setTabs((tabs) => tabs.map((value) => (value.id === tab.id ? { ...value, ...meta } : value)))
                }}
                private={tab.private}
                onCommand={(command) => run(command)}
                onOpenTab={(url) => {
                  // What a private tab opens is private too.
                  const created: Tab = {
                    id: crypto.randomUUID(),
                    title: new URL(url).hostname || url,
                    initialUrl: url,
                    url,
                    private: tab.private
                  }
                  setState((state) => select({ ...state, tabs: [...state.tabs, created] }, created.id))
                }}
                initialUrl={tab.initialUrl}
                initialHistory={tab.initialHistory}
                openPages={tabs.flatMap((other) =>
                  other.id !== tab.id && !other.private && other.url && /^https?:\/\//i.test(other.url)
                    ? [{ url: other.url, title: other.title }]
                    : []
                )}
                onSwitchTab={(url) =>
                  setState((state) => {
                    const shown = state.tabs.find((other) => other.id !== tab.id && !other.private && other.url === url)
                    return shown ? select(state, shown.id) : state
                  })
                }
                request={tab.request}
                adopted={tab.adopted}
                active={active && tab.id === selected}
                onTitle={(title) => {
                  if (tab.url && title && !tab.private) retitle(tab.url, title)
                  setTabs((tabs) =>
                    tabs.map((value) => (value.id === tab.id && value.title !== title ? { ...value, title } : value))
                  )
                }}
              />
            )}
          </div>
        ))}
        <Suspense fallback={null}>
          <BrowserQuickChat active={active && browserOnPage && !pageFullscreen} />
        </Suspense>
      </div>
    </section>
  )
}
