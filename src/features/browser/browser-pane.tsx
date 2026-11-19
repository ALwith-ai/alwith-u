import { useDesktopZoom } from "@alwith/module-desktop-shell/react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  EllipsisVertical,
  Info,
  Lock,
  RotateCw,
  Square,
  Star,
  Trash2,
  TriangleAlert,
  X
} from "lucide-react"
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useStore } from "zustand"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"

import { extensionsPage, extensionStore, resolveAddress, sourcePrefix, translationOf } from "./address"
import type { PaneCommand } from "./commands"
import { type ExtensionAction, ExtensionActions } from "./extension-actions"
import { hiddenExtensions, setExtensionShown } from "./extension-visibility"
import {
  libraryStore,
  type SearchProvider,
  searchProviders,
  setSearchProvider,
  suggest,
  toggleBookmark,
  topSites
} from "./library"
import { LibraryPanel, type SavedLogin } from "./library-panel"
import { type MenuAction, PageContextMenu, type PageMenu } from "./page-menu"
import type { PreviewRequest } from "./preview-request"
import { resumable, type TabHistory } from "./tab-store"

/** How often the page in front is asked for the state it would come back in. */
const pageStateInterval = 5000

export interface Guest {
  label: string
  token: string
  url?: string
  sessionId?: string
}
const url = "about:blank"

/**
 * Websites whose certificate the browser refused since the application started. The browser
 * remembers a user's choice to go on for as long, in every tab, so the warning is kept as long.
 */
const untrustedOrigins = new Set<string>()
const untrusted = (address: string): boolean => {
  try {
    return untrustedOrigins.has(new URL(address).origin)
  } catch {
    return false
  }
}

/** Native chrome state of one guest. Every field is reported by its own browser. */
interface TabUpdate {
  label: string
  title?: string
  url?: string
  loading?: boolean
  progress?: number
  canGoBack?: boolean
  canGoForward?: boolean
  favicon?: string | null
  error?: { url: string; code: number; description: string; crashed?: boolean } | null
  /** The website whose certificate the browser refused in this tab. */
  untrusted?: string | null
  /** The tab's session history as it now stands. */
  history?: TabHistory
  /** A null number is unchanged by this update. */
  find?: { count: number | null; active: number | null; final: boolean }
  permission?: { id: number; origin: string; kinds: string[] } | null
  /** Asked after a sign-in: keep this login? */
  login?: { id: number; origin: string; username: string; update: boolean } | null
  dialog?: {
    id: number
    kind: "alert" | "confirm" | "prompt" | "beforeunload"
    origin: string
    message: string
    defaultText: string
  } | null
  auth?: { id: number; host: string; port: number; realm: string; isProxy: boolean } | null
  fullscreen?: boolean
  menu?: PageMenu | null
}
/** The site a dialog or request speaks for, as the user reads it. */
const hostOf = (origin: string) => {
  try {
    return new URL(origin).host
  } catch {
    return ""
  }
}
/** An answer the user gave a website's request, which the browser keeps. */
interface SitePermission {
  kind: string
  allowed: boolean
}
type HistoryAction = "back" | "forward" | "reload" | "hard-reload" | "stop"
/** What a website may ask for, in the words the user is asked in. */
const permissionNames: Record<string, string> = {
  Camera: "permission.Camera",
  Microphone: "permission.Microphone",
  Geolocation: "permission.Geolocation",
  Notifications: "permission.Notifications",
  ClipboardRead: "permission.ClipboardRead",
  DisplayCapture: "permission.DisplayCapture",
  Midi: "permission.Midi",
  Sensors: "permission.Sensors",
  LocalFonts: "permission.LocalFonts",
  WindowManagement: "permission.WindowManagement",
  PointerLock: "permission.PointerLock",
  AutomaticDownloads: "permission.AutomaticDownloads",
  FileSystemAccess: "permission.FileSystemAccess",
  MediaKeySystemAccess: "permission.MediaKeySystemAccess"
}
export interface TabMeta {
  history?: TabHistory
  url?: string
  loading?: boolean
  favicon?: string | null
  /** The page asked to fill the screen. */
  fullscreen?: boolean
}
const noPages: readonly { url: string; title: string }[] = []
export interface BrowserPaneHandle {
  run: (command: PaneCommand) => void
}

/** The guest is composited in the normal workspace; hiding a pane retains its document. */
export function BrowserPane({
  adopted,
  request,
  onTitle,
  onGuest,
  onMeta,
  onOpenTab,
  private: isPrivate,
  onCommand,
  initialUrl,
  initialHistory,
  openPages = noPages,
  onSwitchTab,
  ref,
  active
}: {
  adopted?: Guest
  onGuest?: (label: string) => void
  onTitle?: (title: string) => void
  onMeta?: (meta: TabMeta) => void
  /** The user asked for an address in a tab of its own. */
  onOpenTab?: (url: string) => void
  /** A tab of which nothing is kept; its browser has a profile of its own that ends with it. */
  private?: boolean
  onCommand?: (command: "new-private-tab") => void
  /** Where a restored or reopened tab starts. */
  initialUrl?: string
  /** The session history that tab resumes, showing the page at that address. */
  initialHistory?: TabHistory
  /** Pages showing in the other ordinary tabs, offered while an address is typed. */
  openPages?: readonly { url: string; title: string }[]
  /** The user chose the tab that shows this address. */
  onSwitchTab?: (url: string) => void
  ref?: Ref<BrowserPaneHandle>
  request?: PreviewRequest
  active: boolean
}) {
  const { t, i18n } = useTranslation()
  const [address, setAddress] = useState(adopted?.url ?? request?.url ?? initialUrl ?? "")
  // The committed location, restored when an address edit is abandoned.
  const location = useRef(address)
  // The same committed location, for what is rendered from it.
  const [page, setPage] = useState({ url: address, title: "" })
  const library = useStore(libraryStore)
  const [editing, setEditing] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const editingAddress = useRef(false)
  const addressInput = useRef<HTMLInputElement>(null)
  const [navigating, setNavigating] = useState(false)
  const [chrome, setChrome] = useState<{
    loading: boolean
    progress: number
    canGoBack: boolean
    canGoForward: boolean
    error: TabUpdate["error"]
    permission: TabUpdate["permission"]
    dialog: TabUpdate["dialog"]
    auth: TabUpdate["auth"]
    fullscreen: boolean
    menu: PageMenu | null
    login: TabUpdate["login"]
  }>({
    loading: false,
    progress: 0,
    canGoBack: false,
    canGoForward: false,
    error: null,
    permission: null,
    dialog: null,
    auth: null,
    fullscreen: false,
    menu: null,
    login: null
  })
  const [credentials, setCredentials] = useState({ username: "", password: "" })
  const [dialogText, setDialogText] = useState("")
  const [find, setFind] = useState<{ text: string; count: number; active: number } | null>(null)
  const findInput = useRef<HTMLInputElement>(null)
  // The search text whose first match was already stepped onto.
  const firstMatch = useRef<string | null>(null)
  const guestCallback = useRef(onGuest)
  guestCallback.current = onGuest
  const [guest, setGuest] = useState<Guest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const acknowledged = useRef<string | null>(null)
  const mountGeneration = useRef(0)
  useEffect(() => {
    const generation = ++mountGeneration.current
    let disposed = false
    let opened: Guest | null = null
    const close = (value: Guest) =>
      void invoke("cef_close_guest", { label: value.label }).catch((error: unknown) => toast.error(String(error)))
    void (
      adopted
        ? Promise.resolve(adopted)
        : invoke<Guest>("cef_open_guest", {
            url: request?.url ?? initialUrl ?? url,
            requestId: request?.id,
            private: isPrivate,
            ...(!request && !isPrivate && resumable(initialHistory, initialUrl ?? "") && { history: initialHistory })
          })
    )
      .then((value) => {
        if (disposed) {
          if (!adopted) close(value)
        } else {
          opened = value
          setGuest(value)
          guestCallback.current?.(value.label)
        }
      })
      .catch((error: unknown) => {
        if (!disposed) setError(String(error))
      })
    return () => {
      disposed = true
      // React's development effect replay remounts synchronously; only report a real removal.
      queueMicrotask(() => {
        if (mountGeneration.current === generation && request && acknowledged.current !== request.id) {
          acknowledged.current = request.id
          void invoke("cef_preview_ready", { id: request.id, label: null, error: "Tab closed while opening" }).catch(
            (failure) => toast.error(String(failure))
          )
        }
      })
      if (adopted)
        queueMicrotask(() => {
          if (mountGeneration.current === generation) close(adopted)
        })
      else if (opened) close(opened)
    }
  }, [])
  const titleCallback = useRef(onTitle)
  titleCallback.current = onTitle
  const metaCallback = useRef(onMeta)
  // The tab's session history as last told, with the state of the page it shows.
  const told = useRef<TabHistory | undefined>(initialHistory)
  // A page's scroll position and form contents change without the browser saying so: the page in front is
  // asked for them every few seconds, so that the tab comes back as it was left.
  const watched = active && !isPrivate && !request?.sessionId && !adopted?.sessionId ? guest?.label : undefined
  useEffect(() => {
    if (!watched) return
    const timer = setInterval(() => {
      void invoke<string | null>("cef_guest_page_state", { label: watched })
        .then((state) => {
          const last = told.current
          const shown = last?.entries[last.shown]
          if (!last || !shown || !state || shown.state === state) return
          told.current = {
            ...last,
            entries: last.entries.map((entry) => (entry === shown ? { ...entry, state } : entry))
          }
          metaCallback.current?.({ history: told.current })
        })
        .catch(() => {})
    }, pageStateInterval)
    return () => clearInterval(timer)
  }, [watched])
  metaCallback.current = onMeta
  useEffect(() => {
    if (!guest) return
    let disposed = false
    const update = (payload: TabUpdate) => {
      if (disposed || payload.label !== guest.label) return
      if (
        payload.url &&
        (/^(https?:|about:blank$)/.test(payload.url) ||
          payload.url.startsWith(extensionsPage) ||
          payload.url.startsWith(sourcePrefix))
      ) {
        location.current = payload.url === "about:blank" ? "" : payload.url
        const committed = location.current
        setPage((page) => (page.url === committed ? page : { url: committed, title: "" }))
        if (!editingAddress.current) setAddress(location.current)
        metaCallback.current?.({ url: payload.url })
      }
      if (payload.title && payload.title !== "Tauri CEF Initial Load") {
        const title = payload.title === "about:blank" ? "" : payload.title
        setPage((page) => ({ ...page, title }))
        titleCallback.current?.(title)
      }
      if (payload.loading !== undefined || payload.favicon !== undefined)
        metaCallback.current?.({
          ...(payload.loading !== undefined && { loading: payload.loading }),
          ...(payload.favicon !== undefined && { favicon: payload.favicon })
        })
      if (payload.history) {
        // The browser tells the pages; what the page shown was left in is asked for apart, and stays with it
        // while the tab is on that page.
        const before = told.current
        const kept = before?.entries[before.shown]
        const shown = payload.history.entries[payload.history.shown]
        told.current =
          kept?.state !== undefined && shown && kept.url === shown.url
            ? {
                ...payload.history,
                entries: payload.history.entries.map((entry) =>
                  entry === shown ? { ...entry, state: kept.state } : entry
                )
              }
            : payload.history
        metaCallback.current?.({ history: told.current })
      }
      if (payload.untrusted) untrustedOrigins.add(payload.untrusted)
      setChrome((state) => ({
        loading: payload.loading ?? state.loading,
        progress: payload.progress ?? state.progress,
        canGoBack: payload.canGoBack ?? state.canGoBack,
        canGoForward: payload.canGoForward ?? state.canGoForward,
        error: payload.error === undefined ? state.error : payload.error,
        permission: payload.permission === undefined ? state.permission : payload.permission,
        dialog: payload.dialog === undefined ? state.dialog : payload.dialog,
        auth: payload.auth === undefined ? state.auth : payload.auth,
        fullscreen: payload.fullscreen ?? state.fullscreen,
        menu: payload.menu === undefined ? state.menu : payload.menu,
        login: payload.login === undefined ? state.login : payload.login
      }))
      if (payload.fullscreen !== undefined) metaCallback.current?.({ fullscreen: payload.fullscreen })
      // A new challenge starts empty; a refused password is never offered back.
      if (payload.auth) setCredentials({ username: "", password: "" })
      if (payload.dialog) setDialogText(payload.dialog.defaultText)
      if (payload.find) {
        const { count, active, final } = payload.find
        setFind((state) => {
          if (!state) return state
          const next = { ...state, count: count ?? state.count, active: active ?? state.active }
          // A new search reports its matches without highlighting one; step onto the first.
          if (final && next.count > 0 && next.active === 0 && firstMatch.current !== next.text) {
            firstMatch.current = next.text
            void invoke("cef_guest_find", { label: guest.label, text: next.text, forward: true, next: true }).catch(
              (failure) => toast.error(String(failure))
            )
          }
          return next
        })
      }
    }
    const subscription = listen<TabUpdate>("browser-tab-updated", ({ payload }) => update(payload))
    void subscription
      .then(async () => {
        // Snapshot after subscribing, so state reported before this tab listened is not lost.
        if (!disposed) {
          const metadata = await invoke<TabUpdate | undefined>("cef_guest_metadata", { label: guest.label })
          if (metadata) update(metadata)
        }
      })
      .catch((failure) => {
        if (!disposed) toast.error(String(failure))
      })
    return () => {
      disposed = true
      void subscription.then((unlisten) => unlisten()).catch(() => {})
    }
  }, [guest])
  useEffect(() => {
    if (!request || acknowledged.current === request.id || (!guest && !error)) return
    acknowledged.current = request.id
    const report = (failure: unknown) =>
      invoke("cef_preview_ready", { id: request.id, label: null, error: String(failure) })
    if (error) {
      void report(error).catch((failure) => toast.error(String(failure)))
      return
    }
    // Creation already navigated this tab. Do not reload redirects or reset page state.
    void invoke("cef_preview_ready", { id: request.id, label: guest!.label, error: null }).catch((failure) =>
      toast.error(String(failure))
    )
  }, [request, guest, error])
  // What the user allowed or refused the website in this tab, and taking it back.
  const [sitePermissions, setSitePermissions] = useState<SitePermission[]>([])
  const resetSite = (data: boolean) => {
    if (!guest) return
    void invoke("cef_guest_reset_site", { label: guest.label, data })
      .then(() => {
        setSitePermissions([])
        toast.success(t(data ? "browser.siteDataCleared" : "browser.permissionsReset"))
      })
      .catch((error) => toast.error(String(error)))
  }
  // The logins saved for the website in this tab: filled in on request, or forgotten.
  const [siteLogins, setSiteLogins] = useState<SavedLogin[]>([])
  const fillLogin = (login: SavedLogin) => {
    if (!guest) return
    void invoke("cef_guest_fill_login", { label: guest.label, origin: login.origin, username: login.username }).catch(
      (error) => toast.error(String(error))
    )
  }
  const forgetLogin = (login: SavedLogin) =>
    void invoke("cef_delete_login", { origin: login.origin, username: login.username })
      .then(() => setSiteLogins((logins) => logins.filter((value) => value !== login)))
      .catch((error) => toast.error(String(error)))
  // Every extension with a button on this tab; the menu says which the toolbar shows.
  const [extensions, setExtensions] = useState<ExtensionAction[]>([])
  const hiddenIds = useStore(hiddenExtensions)
  // A press on one the toolbar does not show, asked for from the menu.
  const [extensionRequest, setExtensionRequest] = useState<{ id: string }>()
  // The page's context menu: a guest has no window to show one on, so it is drawn here and answered.
  const { level: zoom } = useDesktopZoom()
  const answerMenu = (command: number | null) => {
    if (!guest || !chrome.menu) return
    const { id } = chrome.menu
    setChrome((state) => (state.menu?.id === id ? { ...state, menu: null } : state))
    void invoke("cef_guest_context_menu", { label: guest.label, id, command }).catch((error) =>
      toast.error(String(error))
    )
  }
  const chooseFromMenu = (action: MenuAction) => {
    answerMenu("command" in action ? action.command : null)
    if ("open" in action) onOpenTab?.(action.open)
    else if ("copy" in action)
      void navigator.clipboard.writeText(action.copy).catch((error: unknown) => toast.error(String(error)))
    else if ("save" in action && guest)
      void invoke("cef_guest_save", { label: guest.label, url: action.save }).catch((error) =>
        toast.error(String(error))
      )
    else if ("reload" in action) history("reload")
    else if ("source" in action && /^https?:\/\//i.test(page.url)) onOpenTab?.(`${sourcePrefix}${page.url}`)
    else if ("inspect" in action && guest && chrome.menu)
      // The browser finds the element where it reported the menu: in the window's points.
      void invoke("cef_guest_inspect", { label: guest.label, x: chrome.menu.x, y: chrome.menu.y }).catch((error) =>
        toast.error(String(error))
      )
  }
  const history = (action: HistoryAction) => {
    if (!guest) return
    void invoke("cef_guest_history", { label: guest.label, action }).catch((error) => toast.error(String(error)))
  }
  const navigate = (destination: string) => {
    if (!guest) return
    editingAddress.current = false
    setEditing(false)
    setHighlight(-1)
    setLibraryOpen(false)
    setAddress(destination)
    addressInput.current?.blur()
    setNavigating(true)
    void invoke("cef_navigate_guest", { label: guest.label, url: destination })
      .catch((error: unknown) => toast.error(String(error)))
      .finally(() => setNavigating(false))
  }
  // Pages the user already knows, offered only while they are typing something new.
  const suggestions =
    editing && address !== location.current ? suggest(library, address, Date.now(), 6, isPrivate ? [] : openPages) : []
  /** Go where a suggestion leads: to the tab that already shows the page, or to the page here. */
  const choose = (suggestion: (typeof suggestions)[number]) => {
    if (!suggestion.open || !onSwitchTab) return navigate(suggestion.url)
    setEditing(false)
    setAddress(location.current)
    onSwitchTab(suggestion.url)
  }
  const bookmarked = library.bookmarks.some((bookmark) => bookmark.url === page.url)
  const web = /^https?:\/\//i.test(page.url)
  const distrusted = untrusted(page.url)
  const secure = /^https:/i.test(page.url) && !distrusted
  // A blank tab shows the user's own pages instead of an empty document.
  const startPage = !adopted && page.url === "" && !chrome.loading && !chrome.error && !navigating
  const focusAddress = () => {
    addressInput.current?.focus()
    addressInput.current?.select()
  }
  const search = (text: string, forward: boolean, next: boolean) => {
    if (!guest) return
    void invoke("cef_guest_find", { label: guest.label, text, forward, next }).catch((error) =>
      toast.error(String(error))
    )
  }
  // Bumped on every request to find, so an already open bar takes focus again.
  const [findRequest, setFindRequest] = useState(0)
  const openFind = () => {
    setFind((state) => state ?? { text: "", count: 0, active: 0 })
    setFindRequest((request) => request + 1)
  }
  // The field exists only once the bar has rendered; focus moves from the page to it.
  useEffect(() => {
    if (findRequest === 0) return
    findInput.current?.focus()
    findInput.current?.select()
  }, [findRequest])
  const closeFind = () => {
    setFind(null)
    search("", true, false)
  }
  const step = (forward: boolean) => {
    if (find?.text) search(find.text, forward, true)
    else openFind()
  }
  const answerDialog = (accept: boolean) => {
    if (!guest || !chrome.dialog) return
    void invoke("cef_guest_dialog", {
      label: guest.label,
      id: chrome.dialog.id,
      accept,
      text: chrome.dialog.kind === "prompt" && accept ? dialogText : null
    }).catch((error) => toast.error(String(error)))
  }
  const answerAuth = (login: boolean) => {
    if (!guest || !chrome.auth) return
    void invoke("cef_guest_auth", {
      label: guest.label,
      id: chrome.auth.id,
      username: login ? credentials.username : null,
      password: login ? credentials.password : null
    }).catch((error) => toast.error(String(error)))
    setCredentials({ username: "", password: "" })
  }
  const answerLogin = (action: "save" | "never" | "dismiss") => {
    if (!guest || !chrome.login) return
    void invoke("cef_guest_login_answer", { label: guest.label, id: chrome.login.id, action }).catch((error) =>
      toast.error(String(error))
    )
  }
  const answer = (allow: boolean, window = false) => {
    if (!guest || !chrome.permission) return
    void invoke("cef_guest_permission", {
      label: guest.label,
      id: chrome.permission.id,
      allow,
      ...(window && { window })
    }).catch((error) => toast.error(String(error)))
  }
  useImperativeHandle(ref, () => ({
    run: (command) => {
      if (command === "focus-address") focusAddress()
      else if (command === "find") openFind()
      else if (command === "find-next") step(true)
      else if (command === "find-previous") step(false)
      else if (command === "bookmark") {
        if (web) toggleBookmark(page.url, page.title)
      } else if (command === "print") {
        if (guest) void invoke("cef_guest_print", { label: guest.label }).catch((error) => toast.error(String(error)))
      } else if (command === "view-source") {
        if (web) onOpenTab?.(`${sourcePrefix}${page.url}`)
      } else history(command)
    }
  }))
  // A blank tab starts where the user types, like any browser.
  const blank = !adopted && !request && !initialUrl
  useEffect(() => {
    if (blank && active) focusAddress()
  }, [blank, active])
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={t("browser.pane")}>
      <header className="flex h-11 shrink-0 [scrollbar-width:none] items-center gap-0.5 overflow-x-auto overflow-y-hidden border-b bg-background px-2 whitespace-nowrap">
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label={t("browser.back")}
          disabled={!guest || !chrome.canGoBack}
          onClick={() => history("back")}
        >
          <ArrowLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label={t("browser.forward")}
          disabled={!guest || !chrome.canGoForward}
          onClick={() => history("forward")}
        >
          <ArrowRight />
        </Button>
        {chrome.loading ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label={t("browser.stop")}
            disabled={!guest}
            onClick={() => history("stop")}
          >
            <Square />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label={t("browser.reload")}
            disabled={!guest}
            onClick={(event) => history(event.shiftKey ? "hard-reload" : "reload")}
          >
            <RotateCw />
          </Button>
        )}
        {/* The address field, as a browser draws it: what the site is at its head, the bookmark at its end. */}
        <div className="mx-1.5 flex h-8 min-w-48 flex-1 items-center gap-0.5 rounded-full bg-muted px-1 transition-colors focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/60">
          <Popover
            onOpenChange={(open) => {
              // What the user answered this website, read when they look.
              if (open && guest && web) {
                void invoke<SitePermission[]>("cef_guest_site_permissions", { label: guest.label })
                  .then(setSitePermissions)
                  .catch((error) => toast.error(String(error)))
                void invoke<SavedLogin[]>("cef_guest_logins", { label: guest.label })
                  .then(setSiteLogins)
                  .catch((error) => toast.error(String(error)))
              }
            }}
          >
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-7 rounded-full [&_svg]:size-4"
                  aria-label={t("browser.pageInfo")}
                />
              }
            >
              {secure ? (
                <Lock />
              ) : web ? (
                <TriangleAlert className={distrusted ? "text-destructive" : undefined} />
              ) : (
                <Info />
              )}
            </PopoverTrigger>
            <PopoverContent align="start" className="flex flex-col gap-3">
              <p className="text-sm break-all">{address}</p>
              {web && (
                <p className={distrusted ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                  {t(
                    distrusted
                      ? "browser.certificateUntrusted"
                      : secure
                        ? "browser.connectionSecure"
                        : "browser.connectionNotSecure"
                  )}
                </p>
              )}
              {guest && web && (
                <>
                  {sitePermissions.length > 0 && (
                    <ul aria-label={t("browser.sitePermissions")} className="flex flex-col gap-1 text-sm">
                      {sitePermissions.map((permission) => (
                        <li key={permission.kind} className="flex justify-between gap-4">
                          <span>{t(`browser.${permissionNames[permission.kind] ?? "permission.other"}`)}</span>
                          <span className="text-muted-foreground">
                            {t(permission.allowed ? "browser.allowed" : "browser.blocked")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sitePermissions.length === 0}
                    onClick={() => resetSite(false)}
                  >
                    {t("browser.resetPermissions")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => resetSite(true)}>
                    {t("browser.clearSiteData")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void invoke("cef_guest_suggest_password", { label: guest.label })
                        .then(() => toast.success(t("browser.passwordSuggested")))
                        .catch((error) => toast.error(String(error)))
                    }
                  >
                    {t("browser.suggestPassword")}
                  </Button>
                  {siteLogins.length > 0 && (
                    <ul aria-label={t("browser.savedLogins")} className="flex flex-col gap-1 text-sm">
                      {siteLogins.map((login) => (
                        <li key={login.username} className="flex items-center gap-1">
                          <span className="min-w-0 flex-1 truncate">{login.username || t("browser.noUsername")}</span>
                          <Button size="sm" variant="outline" onClick={() => fillLogin(login)}>
                            {t("browser.fillLogin")}
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`${t("browser.deleteLogin")}：${login.username}`}
                            onClick={() => forgetLogin(login)}
                          >
                            <Trash2 />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </PopoverContent>
          </Popover>
          <form
            className="flex min-w-0 flex-1 items-center"
            onSubmit={(event) => {
              event.preventDefault()
              if (!guest || navigating) return
              const chosen = suggestions[highlight]
              if (chosen) {
                choose(chosen)
                return
              }
              try {
                navigate(resolveAddress(address, searchProviders[library.search].url))
              } catch (error) {
                toast.error(error instanceof Error ? error.message : String(error))
              }
            }}
          >
            <Input
              ref={addressInput}
              placeholder={t("browser.addressHint")}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onFocus={(event) => {
                editingAddress.current = true
                setEditing(true)
                event.target.select()
              }}
              onBlur={() => {
                editingAddress.current = false
                setEditing(false)
                setHighlight(-1)
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === "Escape") {
                  setAddress(location.current)
                  event.currentTarget.blur()
                } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length > 0) {
                  event.preventDefault()
                  const step = event.key === "ArrowDown" ? 1 : -1
                  // One position past either end is the typed text itself.
                  setHighlight((index) => ((index + 1 + step + suggestions.length + 1) % (suggestions.length + 1)) - 1)
                }
              }}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={suggestions.length > 0}
              aria-controls="browser-address-suggestions"
              aria-label={t("browser.address")}
              value={address}
              onChange={(event) => {
                setAddress(event.target.value)
                setHighlight(-1)
              }}
              className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1.5 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
            />
          </form>
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-7 rounded-full [&_svg]:size-4"
            aria-label={t(bookmarked ? "browser.removeBookmark" : "browser.addBookmark")}
            aria-pressed={bookmarked}
            disabled={!web}
            onClick={() => toggleBookmark(page.url, page.title)}
          >
            <Star className={bookmarked ? "fill-current" : undefined} />
          </Button>
        </div>
        {guest && (
          <ExtensionActions
            label={guest.label}
            active={active}
            revision={`${page.url} ${chrome.loading}`}
            onActions={setExtensions}
            request={extensionRequest}
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" className="rounded-full" aria-label={t("browser.menu")} />}
          >
            <EllipsisVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("browser.searchEngine")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={library.search}
                onValueChange={(value) => setSearchProvider(value as SearchProvider)}
              >
                {(Object.keys(searchProviders) as SearchProvider[]).map((id) => (
                  <DropdownMenuRadioItem key={id} value={id}>
                    {searchProviders[id].name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={!guest || !/^https?:\/\//i.test(page.url)}
                onClick={() =>
                  guest &&
                  void invoke("cef_guest_print", { label: guest.label }).catch((error) => toast.error(String(error)))
                }
              >
                {t("browser.print")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!web} onClick={() => navigate(translationOf(page.url, i18n.language))}>
                {t("browser.translatePage")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCommand?.("new-private-tab")}>
                {t("browser.newPrivateTab")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLibraryOpen(true)}>{t("browser.library")}</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("browser.extensions")}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => navigate(extensionsPage)}>
                {t("browser.manageExtensions")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate(extensionStore)}>{t("browser.getExtensions")}</DropdownMenuItem>
            </DropdownMenuGroup>
            {extensions.length > 0 && (
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("browser.toolbarExtensions")}</DropdownMenuLabel>
                {extensions.map((extension) => (
                  <DropdownMenuCheckboxItem
                    key={extension.id}
                    checked={!hiddenIds.includes(extension.id)}
                    onCheckedChange={(shown) => setExtensionShown(extension.id, shown)}
                  >
                    {extension.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            )}
            {extensions.some((extension) => hiddenIds.includes(extension.id)) && (
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("browser.hiddenExtensions")}</DropdownMenuLabel>
                {extensions
                  .filter((extension) => hiddenIds.includes(extension.id))
                  .map((extension) => (
                    <DropdownMenuItem
                      key={extension.id}
                      disabled={!extension.enabled}
                      data-extension={extension.id}
                      onClick={() => setExtensionRequest({ id: extension.id })}
                    >
                      {extension.title || extension.name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuGroup>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {suggestions.length > 0 && (
        <ul
          id="browser-address-suggestions"
          role="listbox"
          aria-label={t("browser.suggestions")}
          className="shrink-0 px-3 pb-1"
        >
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.url} role="option" aria-selected={index === highlight}>
              <Button
                variant={index === highlight ? "secondary" : "ghost"}
                size="sm"
                tabIndex={-1}
                className="w-full justify-start gap-2"
                // Keep the address field focused, so the choice is not lost to its blur.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(suggestion)}
              >
                {suggestion.bookmarked && <Star aria-label={t("browser.bookmark")} className="fill-current" />}
                <span className="truncate">{suggestion.title || suggestion.url}</span>
                {suggestion.title && <span className="truncate text-muted-foreground">{suggestion.url}</span>}
                {suggestion.open && (
                  <span className="ml-auto shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {t("browser.switchToTab")}
                  </span>
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {chrome.loading && (
        <Progress
          aria-label={t("browser.progress")}
          value={Math.round(chrome.progress * 100)}
          className="shrink-0 gap-0 **:data-[slot=progress-track]:h-0.5 **:data-[slot=progress-track]:rounded-none"
        />
      )}
      {find && (
        <form
          role="search"
          aria-label={t("browser.find")}
          className="flex h-10 shrink-0 items-center gap-2 px-3"
          onSubmit={(event) => {
            event.preventDefault()
            step(true)
          }}
        >
          <Input
            ref={findInput}
            aria-label={t("browser.findText")}
            placeholder={t("browser.find")}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={find.text}
            className="h-8 max-w-80 min-w-0 flex-1"
            onChange={(event) => {
              const text = event.target.value
              firstMatch.current = null
              setFind({ text, count: 0, active: 0 })
              search(text, true, false)
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === "Escape") closeFind()
              else if (event.key === "Enter" && event.shiftKey) {
                event.preventDefault()
                step(false)
              }
            }}
          />
          <span aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
            {find.text ? `${find.active}/${find.count}` : ""}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("browser.findPrevious")}
            disabled={find.count === 0}
            onClick={() => step(false)}
          >
            <ChevronUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("browser.findNext")}
            disabled={find.count === 0}
            onClick={() => step(true)}
          >
            <ChevronDown />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("browser.findClose")} onClick={closeFind}>
            <X />
          </Button>
        </form>
      )}
      {chrome.dialog && (
        <form
          role="alertdialog"
          aria-label={t("browser.dialog")}
          className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            answerDialog(true)
          }}
        >
          <p className="min-w-0 flex-1 text-sm break-words whitespace-pre-wrap">
            <span className="text-muted-foreground">
              {t("browser.dialogFrom", { site: hostOf(chrome.dialog.origin) || t("browser.thisPage") })}
            </span>
            {chrome.dialog.kind === "beforeunload" ? t("browser.leaveQuestion") : chrome.dialog.message}
          </p>
          {chrome.dialog.kind === "prompt" && (
            <Input
              autoFocus
              aria-label={t("browser.dialogInput")}
              value={dialogText}
              onChange={(event) => setDialogText(event.target.value)}
              className="h-8 max-w-80 min-w-0 flex-1"
            />
          )}
          {chrome.dialog.kind !== "alert" && (
            <Button type="button" size="sm" variant="ghost" onClick={() => answerDialog(false)}>
              {t(chrome.dialog.kind === "beforeunload" ? "browser.stay" : "browser.cancel")}
            </Button>
          )}
          <Button type="submit" size="sm" autoFocus={chrome.dialog.kind !== "prompt"}>
            {t(chrome.dialog.kind === "beforeunload" ? "browser.leave" : "browser.ok")}
          </Button>
        </form>
      )}
      {chrome.auth && (
        <form
          aria-label={t("browser.login")}
          className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            answerAuth(true)
          }}
        >
          <p className="min-w-0 flex-1 text-sm break-words">
            {t(chrome.auth.isProxy ? "browser.proxyLoginRequired" : "browser.loginRequired", {
              server: `${chrome.auth.host}:${chrome.auth.port}`
            })}
            {chrome.auth.realm && <span className="text-muted-foreground">（{chrome.auth.realm}）</span>}
          </p>
          <Input
            autoFocus
            aria-label={t("browser.username")}
            placeholder={t("browser.username")}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={credentials.username}
            onChange={(event) => setCredentials((value) => ({ ...value, username: event.target.value }))}
            className="h-8 w-40"
          />
          <Input
            type="password"
            aria-label={t("browser.password")}
            placeholder={t("browser.password")}
            value={credentials.password}
            onChange={(event) => setCredentials((value) => ({ ...value, password: event.target.value }))}
            className="h-8 w-40"
          />
          <Button type="button" size="sm" variant="ghost" onClick={() => answerAuth(false)}>
            {t("browser.cancel")}
          </Button>
          <Button type="submit" size="sm">
            {t("browser.signIn")}
          </Button>
        </form>
      )}
      {chrome.permission && (
        <div
          role="group"
          aria-label={t("browser.permissionRequest")}
          className="flex shrink-0 items-center gap-2 px-3 py-1.5"
        >
          <p className="min-w-0 flex-1 text-sm">
            <span className="break-all">{chrome.permission.origin || t("browser.thisSite")}</span>{" "}
            {t("browser.wantsToUse")}
            {chrome.permission.kinds
              .map((kind) => t(`browser.${permissionNames[kind] ?? "permission.other"}`))
              .join(t("browser.listSeparator"))}
          </p>
          <Button size="sm" variant="ghost" onClick={() => answer(false)}>
            {t("browser.deny")}
          </Button>
          {chrome.permission.kinds.includes("DisplayCapture") ? (
            // What is shared is then chosen in the system's own picker, among windows or among displays.
            <>
              <Button size="sm" variant="outline" onClick={() => answer(true, true)}>
                {t("browser.shareWindow")}
              </Button>
              <Button size="sm" onClick={() => answer(true)}>
                {t("browser.shareScreen")}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => answer(true)}>
              {t("browser.allow")}
            </Button>
          )}
        </div>
      )}
      {chrome.login && (
        <div
          role="group"
          aria-label={t("browser.loginPrompt")}
          className="flex shrink-0 items-center gap-2 px-3 py-1.5"
        >
          <p className="min-w-0 flex-1 text-sm">
            {t(chrome.login.update ? "browser.updateLogin" : "browser.saveLogin")}{" "}
            <span className="break-all text-muted-foreground">
              {chrome.login.username || t("browser.noUsername")} · {chrome.login.origin}
            </span>
          </p>
          <Button size="sm" variant="ghost" onClick={() => answerLogin("never")}>
            {t("browser.neverSaveLogin")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => answerLogin("dismiss")}>
            {t("browser.notNow")}
          </Button>
          <Button size="sm" onClick={() => answerLogin("save")}>
            {t(chrome.login.update ? "browser.update" : "browser.save")}
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="p-4 text-destructive">
          {error}
        </p>
      ) : guest ? (
        <>
          {chrome.error && !libraryOpen && (
            <div role="alert" className="flex min-h-0 flex-1 flex-col items-start gap-3 overflow-auto p-6">
              <h2 className="text-lg font-medium">
                {t(chrome.error.crashed ? "browser.crashed" : "browser.cannotOpen")}
              </h2>
              <p className="text-sm break-all text-muted-foreground">{chrome.error.url}</p>
              {!chrome.error.crashed && (
                <p className="text-sm text-muted-foreground">
                  {chrome.error.description} ({chrome.error.code})
                </p>
              )}
              <Button size="sm" onClick={() => history("reload")}>
                {t(chrome.error.crashed ? "browser.reloadPage" : "browser.retry")}
              </Button>
            </div>
          )}
          {libraryOpen && <LibraryPanel onOpen={navigate} onClose={() => setLibraryOpen(false)} />}
          {startPage && !libraryOpen && (
            <nav aria-label={t("browser.startPage")} className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6">
              {library.bookmarks.length === 0 && library.history.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("browser.startHint")}</p>
              )}
              {[
                { name: t("browser.bookmarks"), pages: library.bookmarks },
                { name: t("browser.topSites"), pages: topSites(library.history) }
              ]
                .filter((section) => section.pages.length > 0)
                .map((section) => (
                  <section key={section.name} aria-label={section.name} className="flex flex-col gap-2">
                    <h2 className="text-sm font-medium text-muted-foreground">{section.name}</h2>
                    <ul className="flex flex-wrap gap-2">
                      {section.pages.map((entry) => (
                        <li key={entry.url}>
                          <Button variant="outline" size="sm" title={entry.url} onClick={() => navigate(entry.url)}>
                            <span className="max-w-48 truncate">{entry.title || new URL(entry.url).host}</span>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
            </nav>
          )}
          {/* The live surface stays mounted behind a failure or the start page, so the same guest is reused. */}
          {chrome.menu && active && (
            <PageContextMenu
              key={chrome.menu.id}
              menu={chrome.menu}
              scale={zoom}
              onChoose={chooseFromMenu}
              onDismiss={() => answerMenu(null)}
            />
          )}
          <embed
            title={t("browser.livePage")}
            type="application/x-chromium-surface-embed"
            data-content-id={guest.token}
            className={
              chrome.fullscreen
                ? // The page fills the window, above the application's own chrome, as it asked.
                  "fixed inset-0 z-50 size-full bg-background"
                : chrome.error || startPage || libraryOpen
                  ? "hidden"
                  : "min-h-0 w-full flex-1"
            }
          />
        </>
      ) : (
        <p role="status" className="p-4 text-muted-foreground">
          {t("browser.opening")}
        </p>
      )}
    </section>
  )
}
