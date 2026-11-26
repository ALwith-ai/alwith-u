// The launcher is its own window. Main owns the global shortcut, creates the window once and keeps it
// hidden; the launcher shows and hides itself. The two talk in events that name what is meant.
import { emitTo } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow"

import { commands } from "@/bindings"

import { createWindowController } from "./window-controller"

const READY = "launcher:ready"
const SUMMON = "launcher:summon"
const OPEN_SESSION = "launcher:open-session"
const SEND = "launcher:send"

/** What the launcher lists of a chat; main sends the current list with every summon. */
export interface LauncherSession {
  sessionId: string
  title: string | null
  cwd: string
}

async function createLauncherWindow(): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const stop = await getCurrentWebviewWindow().listen(READY, () => resolve())
  // A page that fails before it can announce itself must not leave every summon waiting.
  const timer = setTimeout(() => reject(new Error("Launcher window failed to initialize")), 60_000)
  let stopError: (() => void) | undefined
  let created: WebviewWindow | undefined
  try {
    const window = new WebviewWindow("launcher", {
      url: "/launcher.html",
      title: "",
      width: 680,
      height: 440,
      resizable: false,
      decorations: false,
      alwaysOnTop: true,
      visible: false,
      focus: false,
      maximizable: false,
      minimizable: false,
      skipTaskbar: true
    })
    created = window
    stopError = await window.once("tauri://error", ({ payload }) => reject(new Error(String(payload))))
    await promise
  } catch (error) {
    if (created && (await WebviewWindow.getByLabel("launcher"))) await created.destroy()
    throw error
  } finally {
    clearTimeout(timer)
    stop()
    stopError?.()
  }
}

const controller = createWindowController<LauncherSession[]>({
  exists: async () => (await WebviewWindow.getByLabel("launcher")) !== null,
  create: createLauncherWindow,
  deliver: (sessions) => emitTo("launcher", SUMMON, sessions),
  // The launcher presents itself once it has taken the summon.
  present: () => Promise.resolve()
})

/** Main: create the hidden launcher ahead of the first summon, so that summon only shows it. */
export function prepareLauncher(): Promise<void> {
  return controller.open()
}

/** Main: show the launcher with the chats it may list. */
export function summonLauncher(sessions: LauncherSession[]): Promise<void> {
  return controller.open(sessions)
}

/** Main: act on what the launcher's user picked. */
export async function serveLauncher(host: {
  openSession: (sessionId: string) => void
  send: (text: string) => void
}): Promise<() => void> {
  const window = getCurrentWebviewWindow()
  const stops = await Promise.all([
    window.listen<string>(OPEN_SESSION, ({ payload }) => host.openSession(payload)),
    window.listen<string>(SEND, ({ payload }) => host.send(payload))
  ])
  return () => {
    for (const stop of stops) stop()
  }
}

/** Launcher: take summons from main, then tell it the window can take them. */
export async function takeLauncherSummons(summoned: (sessions: LauncherSession[]) => void): Promise<() => void> {
  const stop = await getCurrentWebviewWindow().listen<LauncherSession[]>(SUMMON, ({ payload }) => summoned(payload))
  await emitTo("main", READY)
  return stop
}

export function presentLauncher(): Promise<null> {
  return commands.presentLauncherWindow()
}

export function dismissLauncher(): Promise<null> {
  return commands.dismissLauncherWindow()
}

export function openLauncherSession(sessionId: string): Promise<void> {
  return emitTo("main", OPEN_SESSION, sessionId)
}

export function sendFromLauncher(text: string): Promise<void> {
  return emitTo("main", SEND, text)
}
