import {
  configureVibemon,
  getVibemonState,
  initializeSettings,
  observeResourceSync,
  refreshSettings,
  sameBinding,
  syncVibemonResources,
  updateVibemonState,
  type VibemonBinding,
  type VibemonPanelLevel,
  type VibemonWindowHost
} from "@alwith/module-auth/vibemon/core"
import { runStateSource } from "@alwith/module-chat/client"
import { exportDraft } from "@alwith/module-chat/conversation"
import { invoke } from "@tauri-apps/api/core"
import { emitTo, listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { LogicalPosition, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window"
import { info } from "@tauri-apps/plugin-log"
import { platform } from "@tauri-apps/plugin-os"
import { toast } from "sonner"

import { commands } from "@/bindings"
import { openPlatformAccount } from "@/features/auth/open-account"
import { createPlatformVibemonAssets } from "@/features/auth/pet-assets"
import { usePlatformAuth } from "@/features/auth/store"
import { logBackgroundError } from "@/lib/background-errors"
import { focusChatSession, openChatWindow, requestChatSurface, syncChatWindowSurface } from "@/lib/chat-window"
import { client, markRead } from "@/lib/client"
import { CODEX_AGENT_ID, runtimeClient } from "@/lib/runtime"

import { collapseToVibemon } from "./collapse"
import { reportVibemonError } from "./display-error"
import { prepareVibemonResource, vibemonResourceIdentity } from "./presentation-resource"
import { createVibemonSessionOwner, type VibemonSurface } from "./session-host"
import { sessionIcons } from "./session-icons"
import { restoreVibemonOnStartup, runVibemonRestoration } from "./startup"
import { serveVibemonRequests, type VibemonRequest, vibemonScope } from "./transport"
import { createVibemonWindowClient, vibemonWindowCall } from "./window-client"

const report = reportVibemonError
let initialized: Promise<void> | null = null
let setMainSurface: ((value: VibemonSurface) => Promise<void>) | null = null

export function initializeVibemonMain(): Promise<void> {
  initialized ??= start()
  return initialized
}
export async function updateMainVibemonSurface(sessionId: string | null, visible: boolean): Promise<void> {
  await initializeVibemonMain()
  if (setMainSurface === null) throw new Error("Vibemon host unavailable")
  await setMainSurface({ sessionId, visible })
}
async function start() {
  const assets = createPlatformVibemonAssets()
  const owner = createVibemonSessionOwner({
    state: () => client.state,
    agentId: CODEX_AGENT_ID,
    source: () => runStateSource(client.state.runStates),
    agentForSession: async (id) => (await runtimeClient()).agentForSession(id),
    claim: (requestId, binding, expectedOwner) =>
      invoke("vibemon_claim", {
        requestId,
        scope: `${vibemonScope()}/${binding.connectionEpoch}`,
        sessionId: binding.sessionId,
        owner: expectedOwner
      }),
    prompt: async (id, content) => {
      await client.prompt(id, content)
    },
    cancel: (id) => client.cancel(id),
    markRead,
    respond: (token, answer) => client.respond(token, answer),
    async openChat(id, windowLabel) {
      if (id !== null) {
        const session = client.state.sessions[id]
        const run = client.state.runStates[id]
        const cwd = session?.cwd ?? run?.cwd
        if (cwd === undefined || cwd === null) throw new Error("Conversation directory unavailable")
        if (windowLabel === "main") {
          await requestChatSurface("main", {
            type: "present",
            transfer: { sessionId: id, cwd, draft: await exportDraft(id) }
          })
        } else if (await WebviewWindow.getByLabel("chat")) await focusChatSession(id)
        else await openChatWindow({ sessionId: id, cwd, draft: await exportDraft(id) })
      } else {
        await openChatWindow()
        const chat = await WebviewWindow.getByLabel("chat")
        if (chat === null) throw new Error("Chat window unavailable")
        await chat.setSize(new LogicalSize(560, 640))
      }
      if (windowLabel === "chat" && (await WebviewWindow.getByLabel("vibemon"))) await command("suspend", "")
    }
  })
  setMainSurface = (value) => owner.surface("main", value)
  const mainWindow = getCurrentWebviewWindow()
  let minimizedRevision = 0
  const refreshMinimized = async () => {
    const revision = ++minimizedRevision
    const minimized = await mainWindow.isMinimized()
    if (revision === minimizedRevision) await owner.minimized(minimized)
  }
  await Promise.all([
    mainWindow.onResized(() => void refreshMinimized().catch(report)),
    mainWindow.onFocusChanged(() => void refreshMinimized().catch(report))
  ])
  await refreshMinimized()
  let queue: Promise<unknown> = Promise.resolve()
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work)
    queue = result.catch(() => {})
    return result
  }
  let presentedResource: { scope: string; vibemonId: string; identity: string } | null = null
  const resourceRefreshes = new Map<string, Promise<void>>()
  function refreshPresentedResource(scope: string, vibemonId: string) {
    const key = JSON.stringify([scope, vibemonId])
    if (resourceRefreshes.has(key)) return
    const work = assets.assets
      .ensureResource(vibemonId)
      .then((resource) =>
        serialize(async () => {
          if (scope !== vibemonScope() || (await getVibemonState()).vibemon !== vibemonId) return
          if (presentedResource?.scope !== scope || presentedResource.vibemonId !== vibemonId) return
          const identity = vibemonResourceIdentity(resource)
          if (presentedResource.identity === identity || !(await WebviewWindow.getByLabel("vibemon"))) return
          await command("reload", vibemonId)
          presentedResource = { scope, vibemonId, identity }
        })
      )
      .catch((error) => logBackgroundError(`vibemon-refresh/${vibemonId}`, error))
      .finally(() => {
        resourceRefreshes.delete(key)
      })
    resourceRefreshes.set(key, work)
  }
  async function command(type: string, vibemonId: string) {
    if (type === "suspend" || type === "close") await emitTo("bubble-menu-vibemon", "vibemon:dismiss")
    const requestId = crypto.randomUUID()
    let resolve!: () => void
    let reject!: (error: Error) => void
    const done = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    const stop = await listen<{ requestId: string; error: string | null }>("vibemon:command-result", ({ payload }) => {
      if (payload.requestId !== requestId) return
      if (payload.error !== null) reject(new Error(payload.error))
      else resolve()
    })
    const timer = setTimeout(() => reject(new Error("Vibemon presentation timed out")), 18_000)
    try {
      await Promise.all([emitTo("vibemon", "vibemon:command", { type, vibemonId, requestId }), done])
    } finally {
      clearTimeout(timer)
      stop()
    }
  }
  async function ensureVibemon(options: { trusted?: boolean; dropCenter?: { x: number; y: number } } = {}) {
    if (platform() !== "macos" && platform() !== "windows") return "unavailable" as const
    const started = performance.now()
    const measure = (stage: string) => {
      if (import.meta.env.DEV)
        void info(`[vibemon-presentation] ${stage} ${Math.round(performance.now() - started)}ms`).catch(console.error)
    }
    const scope = vibemonScope()
    await refreshSettings()
    const state = await getVibemonState()
    if (!state.vibemon) throw new Error("Select a Vibemon in the vibemon center first")
    const existing = await WebviewWindow.getByLabel("vibemon")
    let identity: string
    let needsRefresh = true
    if (existing !== null && presentedResource?.scope === scope && presentedResource.vibemonId === state.vibemon) {
      identity = presentedResource.identity
      measure("renderer-reused")
    } else {
      const prepared = await prepareVibemonResource(assets.assets, state.vibemon)
      identity = vibemonResourceIdentity(prepared.resource)
      needsRefresh = prepared.needsRefresh
      measure("cache-ready")
    }
    if (scope !== vibemonScope() || (await getVibemonState()).vibemon !== state.vibemon)
      throw new Error("The selected vibemon changed during presentation")
    const placeVibemon = async () => {
      if (!options.dropCenter) return
      const vibemon = await WebviewWindow.getByLabel("vibemon")
      if (!vibemon) throw new Error("Vibemon window unavailable")
      const size = await vibemon.outerSize()
      if (platform() === "macos") {
        const main = await WebviewWindow.getByLabel("main")
        if (!main) throw new Error("Main window unavailable")
        const [mainScale, vibemonScale] = await Promise.all([main.scaleFactor(), vibemon.scaleFactor()])
        // AppKit uses desktop points across displays, even when their backing scales differ.
        await vibemon.setPosition(
          new LogicalPosition(
            options.dropCenter.x / mainScale - size.width / vibemonScale / 2,
            options.dropCenter.y / mainScale - size.height / vibemonScale / 2
          )
        )
        return
      }
      await vibemon.setPosition(
        new PhysicalPosition(
          Math.round(options.dropCenter.x - size.width / 2),
          Math.round(options.dropCenter.y - size.height / 2)
        )
      )
    }
    const completeOpen = async () => {
      if (scope !== vibemonScope() || (await getVibemonState()).vibemon !== state.vibemon)
        throw new Error("The selected vibemon changed during presentation")
      await updateVibemonState({ enabled: true })
      presentedResource = { scope, vibemonId: state.vibemon, identity }
      if (needsRefresh) refreshPresentedResource(scope, state.vibemon)
      measure("presented")
      toast.dismiss("vibemon-startup")
      return "shown" as const
    }
    if (existing !== null) {
      if (
        presentedResource?.scope !== scope ||
        presentedResource.vibemonId !== state.vibemon ||
        presentedResource.identity !== identity
      )
        await command("reload", state.vibemon)
      await placeVibemon()
      await command("present", state.vibemon)
      return completeOpen()
    }
    const owned = assets.assets.snapshot().owned
    if (!options.trusted || !owned?.some((item) => item.vibemon_uuid === state.vibemon))
      await assets.assets.getMyVibemons()
    if (!assets.assets.snapshot().owned?.some((item) => item.vibemon_uuid === state.vibemon))
      throw new Error("This account does not own the selected Vibemon")
    if (scope !== vibemonScope()) throw new Error("The vibemon account changed")
    measure("ownership-ready")
    let ready!: () => void
    let fail!: (error: Error) => void
    const prepared = new Promise<void>((res, rej) => {
      ready = res
      fail = rej
    })
    const stop = await listen<{ vibemonId: string }>("vibemon:ready", ({ payload }) => {
      if (payload.vibemonId === state.vibemon) ready()
    })
    const timer = setTimeout(() => fail(new Error("The selected vibemon could not render")), 18_000)
    try {
      await Promise.all([
        prepared,
        (async () => {
          await vibemonWindowCall("create-bubble")
          if (!(await vibemonWindowCall<boolean>("create-vibemon"))) ready()
        })()
      ])
      measure("window-ready")
      if (scope !== vibemonScope()) throw new Error("The vibemon account changed")
      await placeVibemon()
      await command("present", state.vibemon)
      return await completeOpen()
    } catch (error) {
      await vibemonWindowCall("destroy-vibemon")
      throw error
    } finally {
      clearTimeout(timer)
      stop()
    }
  }
  async function showVibemonWithoutChat(options: { trusted?: boolean; dropCenter?: { x: number; y: number } } = {}) {
    const result = await ensureVibemon(options)
    if (result === "shown") {
      const chat = await WebviewWindow.getByLabel("chat")
      if (chat !== null) {
        await chat.hide()
        await syncChatWindowSurface()
      }
    }
    return result
  }
  async function closeVibemon() {
    if (await WebviewWindow.getByLabel("vibemon")) await command("close", (await getVibemonState()).vibemon)
    // Keep the suspended renderer for the next explicit presentation.
    await updateVibemonState({ enabled: false, position: null })
  }
  const windows: VibemonWindowHost = {
    ...createVibemonWindowClient(),
    openVibemon: (options = {}) => serialize(() => showVibemonWithoutChat(options)),
    closeVibemon: () => serialize(closeVibemon),
    openRecharge: openPlatformAccount
  }
  configureVibemon({
    sessionIcons,
    ...assets,
    sessions: { ...owner, openChat: (binding) => owner.openChat(binding) },
    windows,
    onResourceSyncError: (error, context) =>
      logBackgroundError(`vibemon-sync/${context.phase}/${context.vibemonId ?? "catalog"}`, error),
    resourcesSynchronized: (updated) => {
      const scope = vibemonScope()
      return serialize(() =>
        restoreInBackground(async () => {
          if (scope !== vibemonScope()) return
          await refreshSettings()
          const state = await getVibemonState()
          if (!state.enabled || !state.vibemon) return
          if (await WebviewWindow.getByLabel("vibemon")) {
            if (updated.has(state.vibemon)) await command("reload", state.vibemon)
          } else if (
            owner.snapshot()?.surfaceVisible !== true &&
            (await assets.assets.resources.inspect(state.vibemon))
          )
            await ensureVibemon()
        })
      )
    },
    onError: report
  })
  await initializeSettings()
  async function handle(request: VibemonRequest) {
    const payload = request.payload as {
      binding: VibemonBinding
      requestId: string
      text: string
      token: string
      optionId: string
      label: "main" | "chat"
      sessionId: string | null
      visible: boolean
      vibemonId: string
      dropCenter?: { x: number; y: number }
      level: VibemonPanelLevel
      trusted?: boolean
    }
    switch (request.action) {
      case "sync-resources":
        void syncVibemonResources()
        return null
      case "inspect":
        await owner.refresh()
        return owner.snapshot()
      case "task-panel":
        return owner.panel(payload.level)
      case "cancel-task":
        return owner.cancel(payload.binding, payload.requestId)
      case "dismiss-task":
        return owner.dismiss(payload.binding)
      case "send":
        return owner.send(payload.binding, payload.requestId, payload.text)
      case "answer":
        await refreshMinimized()
        return owner.answer(payload.binding, payload.requestId, payload.token, payload.optionId)
      case "open-chat":
        return owner.openChat(payload.binding)
      case "activate":
        return owner.activate()
      case "select-session":
        if (payload.sessionId === null) throw new Error("Choose a conversation")
        return owner.select(payload.binding, payload.sessionId)
      case "bubble-interact":
      case "dismiss-result": {
        await owner.refresh()
        const value = owner.snapshot()
        if (value === null || !sameBinding(value.binding, payload.binding))
          throw new Error("The vibemon conversation changed")
        if (
          request.action === "dismiss-result" &&
          (value.prompt !== null || (value.state !== "done" && value.state !== "idle"))
        )
          return
        await command(
          request.action === "bubble-interact" ? "bubble-interact" : "bubble-close",
          (await getVibemonState()).vibemon
        )
        return
      }
      case "surface": {
        if (payload.label !== request.from || !["main", "chat"].includes(payload.label))
          throw new Error("Invalid conversation surface")
        return owner.surface(payload.label, { sessionId: payload.sessionId, visible: payload.visible })
      }
      case "open-from-lounge":
        if (request.from !== "main") throw new Error("Only main owns the lounge")
        return serialize(async () => {
          if ((await getVibemonState()).vibemon !== payload.vibemonId) throw new Error("The selected vibemon changed")
          const center = payload.dropCenter
          if (center !== undefined && (!Number.isFinite(center.x) || !Number.isFinite(center.y)))
            throw new Error("Invalid vibemon drop position")
          return showVibemonWithoutChat({ trusted: true, dropCenter: center })
        })
      case "open-vibemon":
        return windows.openVibemon({ trusted: payload.trusted === true })
      case "close-vibemon":
        return windows.closeVibemon()
      case "recharge":
        return windows.openRecharge()
      case "hide-vibemon":
        return serialize(async () => {
          if (await WebviewWindow.getByLabel("vibemon")) await command("suspend", "")
          await updateVibemonState({ enabled: false })
        })
      case "restore-vibemon":
        return serialize(async () => {
          await refreshSettings()
          if ((await getVibemonState()).vibemon) await ensureVibemon()
        })
      case "collapse": {
        if (request.from !== "chat") throw new Error("Only chat can collapse to a vibemon")
        return serialize(async () => {
          const chat = await WebviewWindow.getByLabel("chat")
          if (chat === null) throw new Error("Chat window unavailable")
          return collapseToVibemon({
            validate() {
              if (Date.now() >= request.deadline || request.scope !== vibemonScope())
                throw new Error("Vibemon request expired")
              owner.requireSurface("chat", payload.sessionId)
            },
            async equippedVibemon() {
              await refreshSettings()
              return (await getVibemonState()).vibemon
            },
            hasVibemon: async () => (await assets.assets.getMyVibemons()).length > 0,
            async showVibemon() {
              if ((await ensureVibemon({ trusted: true })) !== "shown")
                throw new Error("Desktop vibemon are unavailable on this platform")
            },
            bindSession: () => owner.collapse(payload.sessionId),
            async hideChat() {
              await chat.hide()
              await syncChatWindowSurface()
              await owner.surface("chat", { sessionId: payload.sessionId, visible: false })
              await vibemonWindowCall("focus-bubble")
            },
            restoreChat: () => openChatWindow()
          })
        })
      }
      default:
        throw new Error("Unsupported Vibemon request")
    }
  }
  await serveVibemonRequests(handle)
  owner.subscribe((value) => {
    for (const label of ["vibemon", "bubble-menu-vibemon"])
      void emitTo(label, "vibemon:observation", value).catch(console.error)
  })
  client.store.subscribe(() => {
    if (assets.account() !== null) void owner.refresh().catch(report)
  })
  await listen<{ x: number; y: number }>("vibemon:position", ({ payload }) => {
    void updateVibemonState({ position: payload }).catch(report)
  })
  await listen("vibemon:close", () => {
    void windows.closeVibemon().catch(report)
  })
  await listen("tray:toggle-vibemon", () => {
    void serialize(async () => {
      const vibemon = await WebviewWindow.getByLabel("vibemon")
      if (vibemon !== null && (await vibemon.isVisible())) await closeVibemon()
      else await showVibemonWithoutChat()
    })
      .catch(async (error) => {
        await commands.showMainWindow()
        report(error)
      })
      .catch(report)
  })
  await commands.trayVibemonReady()
  function currentAccount() {
    return assets.account() === null ? null : vibemonScope()
  }
  function restoreInBackground(work: () => Promise<unknown>) {
    return runVibemonRestoration(work, currentAccount, () => {
      void serialize(() => restoreInBackground(() => ensureVibemon()))
    })
  }
  const restore = async () => {
    if (usePlatformAuth.getState().isLoading) return
    if (assets.account() !== null) void syncVibemonResources()
    let restored = false
    try {
      await restoreInBackground(async () => {
        restored = await restoreVibemonOnStartup(showVibemonWithoutChat, currentAccount)
      })
    } finally {
      await commands.autostartComplete({ restored })
    }
  }
  usePlatformAuth.subscribe((state, previous) => {
    if (state.user?.user_uuid !== previous.user?.user_uuid || (previous.isLoading && !state.isLoading)) {
      owner.invalidate()
      observeResourceSync("idle")
      toast.dismiss("vibemon-startup")
      void serialize(async () => {
        await vibemonWindowCall("destroy-vibemon")
        await restore()
      }).catch(report)
    }
  })
  void serialize(restore).catch(report)
}
