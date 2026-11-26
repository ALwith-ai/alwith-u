import { commands as installedApps } from "@alwith/module-installed-apps/commands"
import type { AppInfo_Serialize, CatalogUpdate_Serialize } from "@alwith/module-installed-apps/commands"
import { Channel } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"

import { commands } from "@/bindings"
import {
  dismissLauncher,
  type LauncherSession,
  openLauncherSession,
  presentLauncher,
  sendFromLauncher,
  takeLauncherSummons
} from "@/lib/launcher-window"
import { basename } from "@/lib/path"
import { settingsStore, updateSettings } from "@/lib/settings-store"

import { ClipboardConsent, type ClipboardHost, ClipboardView } from "./clipboard-view"
import { LauncherView } from "./launcher-view"
import { type Entry, index } from "./lib/order"
import { pruned, type Usage, visited } from "./lib/usage"

const APPLICATION = "application:"
const SESSION = "session:"

const clipboard: ClipboardHost = {
  list: (query, limit) => commands.clipboardList({ query, limit }),
  thumbnail: (id) => commands.clipboardThumbnail({ id }),
  copy: (id) => commands.clipboardCopy({ id }),
  pin: (id, pinned) => commands.clipboardPin({ id, pinned }),
  remove: (id) => commands.clipboardRemove({ id }),
  watch: (changed) => listen("clipboard:changed", changed)
}
/** Rows are 16 points tall; twice that in pixels stays sharp on a Retina display. */
const ICON_PIXELS = 32
const icons = new Map<string, Promise<string | null>>()
/** An application's row icon, asked for once; other kinds of entry have none of their own. */
function applicationIcon(entry: Entry): Promise<string | null> {
  if (entry.kind !== "application") return Promise.resolve(null)
  let icon = icons.get(entry.id)
  if (icon === undefined) {
    icon = installedApps.readAppIconSized({ identifier: entry.id.slice(APPLICATION.length), pixels: ICON_PIXELS })
    icons.set(entry.id, icon)
  }
  return icon
}
const subscribeSettings = (notify: () => void) => settingsStore.subscribe(notify)
const clipboardEnabled = () => settingsStore.get<boolean>("clipboard.enabled") === true

/** The usage is the launcher's own record: nothing else reads it, so it is not a shared preference. */
const USAGE = "launcher.usage"

export function LauncherWindow() {
  const { t } = useTranslation()
  const [applications, setApplications] = useState<AppInfo_Serialize[]>([])
  const [sessions, setSessions] = useState<LauncherSession[]>([])
  const [usage, setUsage] = useState<Usage>(() => pruned(settingsStore.get<Usage>(USAGE) ?? {}, Date.now()))
  // Every summon starts from an empty query.
  const [summon, setSummon] = useState(0)
  const [mode, setMode] = useState<"launcher" | "clipboard">("launcher")
  const [clipboardSupported, setClipboardSupported] = useState(false)
  const recording = useSyncExternalStore(subscribeSettings, clipboardEnabled)

  useEffect(() => {
    void commands.clipboardSupported().then(setClipboardSupported)
  }, [])

  useEffect(() => {
    const updates = new Channel<CatalogUpdate_Serialize>((update) => {
      if (update.type === "failed") throw new Error(`Application catalog failed: ${JSON.stringify(update.error)}`)
      setApplications(update.apps)
    })
    void installedApps.listApplicationNames({ updates }).then(setApplications)
  }, [])

  useEffect(() => {
    const taking = takeLauncherSummons((listed) => {
      setSessions(listed)
      setSummon((count) => count + 1)
      setMode("launcher")
      void presentLauncher()
    })
    // Losing the keyboard is the launcher's cue to leave.
    const watching = getCurrentWebviewWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) void dismissLauncher()
    })
    return () => {
      void taking.then((stop) => stop())
      void watching.then((stop) => stop())
    }
  }, [])

  const catalog = useMemo(
    () =>
      [
        ...applications.map((application): Entry => ({
          id: APPLICATION + application.bundle_id,
          kind: "application",
          title: application.name,
          alternates: [],
          subtitle: "",
          alias: ""
        })),
        ...sessions.map((session): Entry => ({
          id: SESSION + session.sessionId,
          kind: "session",
          title: session.title ?? t("sidebar.untitled"),
          alternates: [],
          subtitle: basename(session.cwd),
          alias: ""
        }))
      ].map(index),
    [applications, sessions, t]
  )

  if (mode === "clipboard") {
    const leave = { onLeave: () => setMode("launcher"), onDismiss: () => void dismissLauncher() }
    return recording ? (
      <ClipboardView key={summon} host={clipboard} onCopied={() => void dismissLauncher()} {...leave} />
    ) : (
      <ClipboardConsent onEnable={() => void updateSettings({ "clipboard.enabled": true })} {...leave} />
    )
  }
  return (
    <LauncherView
      key={summon}
      catalog={catalog}
      icon={applicationIcon}
      usage={usage}
      onOpen={(entry, query) => {
        const learned = visited(usage, entry.id, query, Date.now())
        setUsage(learned)
        void updateSettings({ [USAGE]: learned })
        void dismissLauncher()
        if (entry.kind === "application")
          void installedApps.openAppById({ bundleId: entry.id.slice(APPLICATION.length) })
        else void openLauncherSession(entry.id.slice(SESSION.length))
      }}
      onSend={(text) => {
        void dismissLauncher()
        void sendFromLauncher(text)
      }}
      onClipboard={clipboardSupported ? () => setMode("clipboard") : undefined}
      onDismiss={() => void dismissLauncher()}
    />
  )
}
