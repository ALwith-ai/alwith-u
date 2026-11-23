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
import { usePlatformAuth } from "@/features/auth/store"
import { createPlatformVibemonAssets } from "@/features/auth/vibemon-assets"
import { logBackgroundError } from "@/lib/background-errors"
import { focusChatSession, openChatWindow, requestChatSurface, syncChatWindowSurface } from "@/lib/chat-window"
import { client, markRead } from "@/lib/client"
import { CODEX_AGENT_ID, runtimeClient } from "@/lib/runtime"
import { observeWindowHidden } from "@/lib/window-hidden"

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
  const [mainWindowState, chatWindowState] = await Promise.all([
    observeWindowHidden(mainWindow, (hidden) => owner.windowHidden("main", hidden), report),
    observeWindowHidden(
      mainWindow,
      (hidden) => owner.windowHidden("chat", hidden),
      report,
      () => invoke<boolean>("chat_window_hidden"),
      "alwith:chat-window-hidden"
    )
  ])
  let queue: Promise<unknown> = Promise.resolve()
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work)
    queue = result.catch(() => {})
    return result
  }
  let rendererResource: {
    scope: string
    vibemonId: string
    identity: string
  } | null = null
  const resourceRefreshes = new Map<string, Promise<void>>()
  function refreshPresentedResource(scope: string, vibemonId: string) {
    const key = JSON.stringify([scope, vibemonId])
    if (resourceRefreshes.has(key)) return
    const work = assets.assets
      .ensureResource(vibemonId)
      .then((resource) =>
        serialize(async () => {
          if (scope !== vibemonScope() || (await getVibemonState()).vibemon !== vibemonId) return
          if (rendererResource?.scope !== scope || rendererResource.vibemonId !== vibemonId) return
          const identity = vibemonResourceIdentity(resource)
          if (rendererResource.identity === identity || !(await WebviewWindow.getByLabel("vibemon"))) return
          await command("reload", vibemonId)
          rendererResource = { scope, vibemonId, identity }
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
  // Preparation runs on the same queue as presentation and destruction, but the chat
  // surface notification never waits for it. The renderer identity survives suspension.
  let warming: { scope: string; vibemonId: string; task: Promise<void> } | null = null
  let accountRevision = 0
  async function prepareVibemon(scope: string, vibemonId: string, trusted: boolean) {
    const revision = accountRevision
    const current = async () => {
      const selected = (await getVibemonState()).vibemon
      if (revision !== accountRevision || scope !== currentAccount() || selected !== vibemonId)
        throw new Error("The selected vibemon changed during preparation")
    }
    await current()
    const existing = await WebviewWindow.getByLabel("vibemon")
    if (existing && rendererResource?.scope === scope && rendererResource.vibemonId === vibemonId)
      return { needsRefresh: true, current }

    const prepared = await prepareVibemonResource(assets.assets, vibemonId)
    const owned = assets.assets.snapshot().owned
    if (!trusted || !owned?.some((item) => item.vibemon_uuid === vibemonId)) await assets.assets.getMyVibemons()
    if (!assets.assets.snapshot().owned?.some((item) => item.vibemon_uuid === vibemonId))
      throw new Error("This account does not own the selected Vibemon")
    await current()
    let ready!: () => void
    let fail!: (error: Error) => void
    const rendererReady = new Promise<void>((res, rej) => {
      ready = res
      fail = rej
    })
    const stop = await listen<{ vibemonId: string }>("vibemon:ready", ({ payload }) => {
      if (payload.vibemonId === vibemonId) ready()
    })
    const timer = setTimeout(() => fail(new Error("The selected vibemon could not render")), 18_000)
    try {
      await Promise.all([
        rendererReady,
        (async () => {
          await vibemonWindowCall("create-bubble")
          if (existing) await command("reload", vibemonId)
          else if (!(await vibemonWindowCall<boolean>("create-vibemon"))) ready()
        })()
      ])
      await current()
      rendererResource = {
        scope,
        vibemonId,
        identity: vibemonResourceIdentity(prepared.resource)
      }
      return { needsRefresh: prepared.needsRefresh, current }
    } catch (error) {
      rendererResource = null
      await vibemonWindowCall("destroy-vibemon")
      throw error
    } finally {
      clearTimeout(timer)
      stop()
    }
  }
  async function warmChatVibemon(scope: string) {
    if (platform() !== "macos" && platform() !== "windows") return
    await refreshSettings()
    const { vibemon } = await getVibemonState()
    if (!vibemon || scope !== currentAccount()) return
    if (warming?.scope === scope && warming.vibemonId === vibemon) return warming.task
    const task = serialize(async () => {
      await prepareVibemon(scope, vibemon, true)
    })
    warming = { scope, vibemonId: vibemon, task }
    try {
      await task
    } finally {
      if (warming?.task === task) warming = null
    }
  }

  async function presentVibemon(
    options: {
      trusted?: boolean
      dropCenter?: { x: number; y: number }
      validate?: () => void
    } = {}
  ) {
    if (platform() !== "macos" && platform() !== "windows") return "unavailable" as const
    const started = performance.now()
    const scope = vibemonScope()
    await refreshSettings()
    const state = await getVibemonState()
    if (!state.vibemon) throw new Error("Select a Vibemon in the vibemon center first")
    const prepared = await prepareVibemon(scope, state.vibemon, options.trusted === true)
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
    await placeVibemon()
    await prepared.current()
    options.validate?.()
    await command("present", state.vibemon)
    await prepared.current()
    await updateVibemonState({ enabled: true })
    if (prepared.needsRefresh) refreshPresentedResource(scope, state.vibemon)
    if (import.meta.env.DEV)
      void info(`[vibemon-presentation] presented ${Math.round(performance.now() - started)}ms`).catch(console.error)
    toast.dismiss("vibemon-startup")
    return "shown" as const
  }
  async function showVibemonWithoutChat(options: { trusted?: boolean; dropCenter?: { x: number; y: number } } = {}) {
    const result = await presentVibemon(options)
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
            await presentVibemon()
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
      path?: string
    }
    switch (request.action) {
      case "asset-read": {
        if (request.from !== "vibemon" && request.from !== "bubble-menu-vibemon")
          throw new Error("Only Vibemon windows may request asset reads")
        if (payload.path === "/api/v1/vibemons/mine") return assets.assets.getMyVibemons()
        const detail = /^\/api\/v1\/vibemons\/([^/]+)$/.exec(payload.path ?? "")
        if (detail && detail[1] !== "catalog") return assets.assets.getVibemonDetail(decodeURIComponent(detail[1]))
        throw new Error("Unsupported Vibemon asset read")
      }
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
        await Promise.all([mainWindowState.refresh(), chatWindowState.refresh()])
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
        await owner.surface(payload.label, {
          sessionId: payload.sessionId,
          visible: payload.visible
        })
        if (payload.label === "chat" && payload.visible)
          void warmChatVibemon(request.scope).catch((error) => logBackgroundError("vibemon-prewarm", error))
        return
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
          if ((await getVibemonState()).vibemon) await presentVibemon()
        })
      case "collapse": {
        if (request.from !== "chat") throw new Error("Only chat can collapse to a vibemon")
        const pending = warming
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
              const id = (await getVibemonState()).vibemon
              if (pending?.scope === request.scope && pending.vibemonId === id) await pending.task
              return id
            },
            hasVibemon: async () => (await assets.assets.getMyVibemons()).length > 0,
            async showVibemon() {
              if (
                (await presentVibemon({
                  trusted: true,
                  validate: () => owner.requireSurface("chat", payload.sessionId)
                })) !== "shown"
              )
                throw new Error("Desktop vibemon are unavailable on this platform")
            },
            bindSession: () => owner.collapse(payload.sessionId),
            async hideChat() {
              await chat.hide()
              await syncChatWindowSurface()
              await owner.surface("chat", {
                sessionId: payload.sessionId,
                visible: false
              })
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
      void serialize(() => restoreInBackground(() => presentVibemon()))
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
      accountRevision++
      rendererResource = null
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
