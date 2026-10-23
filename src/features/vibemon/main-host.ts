import {
  configureVibemon,
  getVibemonState,
  initializeSettings,
  observeResourceSync,
  type PetBinding,
  type PetWindowHost,
  refreshSettings,
  sameBinding,
  syncVibemonResources,
  updateVibemonState
} from "@alwith/module-auth/pets/core"
import { invoke } from "@tauri-apps/api/core"
import { emitTo, listen } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { info } from "@tauri-apps/plugin-log"
import { platform } from "@tauri-apps/plugin-os"
import { toast } from "sonner"

import { runStateSource } from "@/agent/run-state-source"
import { commands } from "@/bindings"
import { openPlatformAccount } from "@/features/auth/open-account"
import { createPlatformPetAssets } from "@/features/auth/pet-assets"
import { usePlatformAuth } from "@/features/auth/store"
import { exportDraft } from "@/features/chat/composer/drafts"
import { logBackgroundError } from "@/lib/background-errors"
import { openChatWindow, syncChatWindowSurface } from "@/lib/chat-window"
import { client } from "@/lib/client"
import { CODEX_AGENT_ID, runtimeClient } from "@/lib/runtime"

import { collapseToPet } from "./collapse"
import { reportPetError } from "./display-error"
import { petResourceIdentity, preparePetResource } from "./presentation-resource"
import { createPetSessionOwner, type PetSurface } from "./session-host"
import { sessionIcons } from "./session-icons"
import { restorePetOnStartup, runPetRestoration } from "./startup"
import { type PetRequest, petScope, servePetRequests } from "./transport"
import { createPetWindowClient, petWindowCall } from "./window-client"

const report = reportPetError
let initialized: Promise<void> | null = null
let setMainSurface: ((value: PetSurface) => Promise<void>) | null = null

export function initializeVibemonMain(): Promise<void> {
  initialized ??= start()
  return initialized
}
export async function updateMainPetSurface(sessionId: string | null, visible: boolean): Promise<void> {
  await initializeVibemonMain()
  if (setMainSurface === null) throw new Error("Vibemon host unavailable")
  await setMainSurface({ sessionId, visible })
}
async function start() {
  const assets = createPlatformPetAssets()
  const owner = createPetSessionOwner({
    state: () => client.state,
    agentId: CODEX_AGENT_ID,
    source: () => runStateSource(client.state.runStates),
    agentForSession: async (id) => (await runtimeClient()).agentForSession(id),
    claim: (requestId, binding, expectedOwner) =>
      invoke("vibemon_claim", {
        requestId,
        scope: `${petScope()}/${binding.connectionEpoch}`,
        sessionId: binding.sessionId,
        owner: expectedOwner
      }),
    prompt: (id, content) => client.prompt(id, content),
    respond: (token, answer) => client.respond(token, answer),
    async openChat(id, windowLabel) {
      if (windowLabel === "main") {
        await commands.showMainWindow()
      } else if (id === null || (await WebviewWindow.getByLabel("chat")) !== null) await openChatWindow()
      else {
        const session = client.state.sessions[id]
        if (session === undefined) throw new Error("Open this conversation from the thread list")
        await openChatWindow({ sessionId: id, cwd: session.cwd, draft: await exportDraft(id) })
      }
      if (await WebviewWindow.getByLabel("vibemon")) await command("suspend", "")
    }
  })
  setMainSurface = (value) => owner.surface("main", value)
  let queue: Promise<unknown> = Promise.resolve()
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work)
    queue = result.catch(() => {})
    return result
  }
  let presentedResource: { scope: string; petId: string; identity: string } | null = null
  const resourceRefreshes = new Map<string, Promise<void>>()
  function refreshPresentedResource(scope: string, petId: string) {
    const key = JSON.stringify([scope, petId])
    if (resourceRefreshes.has(key)) return
    const work = assets.assets
      .ensureResource(petId)
      .then((resource) =>
        serialize(async () => {
          if (scope !== petScope() || (await getVibemonState()).pet !== petId) return
          if (!presentedResource || presentedResource.scope !== scope || presentedResource.petId !== petId) return
          const identity = petResourceIdentity(resource)
          if (presentedResource.identity === identity || !(await WebviewWindow.getByLabel("vibemon"))) return
          await command("reload", petId)
          presentedResource = { scope, petId, identity }
        })
      )
      .catch((error) => logBackgroundError(`pet-refresh/${petId}`, error))
      .finally(() => {
        resourceRefreshes.delete(key)
      })
    resourceRefreshes.set(key, work)
  }
  async function command(type: string, petId: string) {
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
    const timer = setTimeout(() => reject(new Error("Pet presentation timed out")), 18_000)
    try {
      await Promise.all([emitTo("vibemon", "vibemon:command", { type, petId, requestId }), done])
    } finally {
      clearTimeout(timer)
      stop()
    }
  }
  async function ensurePet(options: { trusted?: boolean } = {}) {
    if (platform() !== "macos" && platform() !== "windows") return "unavailable" as const
    const started = performance.now()
    const measure = (stage: string) => {
      if (import.meta.env.DEV)
        void info(`[pet-presentation] ${stage} ${Math.round(performance.now() - started)}ms`).catch(console.error)
    }
    const scope = petScope()
    await refreshSettings()
    const state = await getVibemonState()
    if (!state.pet) throw new Error("Select a Vibemon in the pet center first")
    const existing = await WebviewWindow.getByLabel("vibemon")
    let identity: string
    let needsRefresh = true
    if (existing !== null && presentedResource?.scope === scope && presentedResource.petId === state.pet) {
      identity = presentedResource.identity
      measure("renderer-reused")
    } else {
      const prepared = await preparePetResource(assets.assets, state.pet)
      identity = petResourceIdentity(prepared.resource)
      needsRefresh = prepared.needsRefresh
      measure("cache-ready")
    }
    if (scope !== petScope() || (await getVibemonState()).pet !== state.pet)
      throw new Error("The selected pet changed during presentation")
    const completeOpen = async () => {
      if (scope !== petScope() || (await getVibemonState()).pet !== state.pet)
        throw new Error("The selected pet changed during presentation")
      await updateVibemonState({ enabled: true })
      presentedResource = { scope, petId: state.pet, identity }
      if (needsRefresh) refreshPresentedResource(scope, state.pet)
      measure("presented")
      toast.dismiss("pet-startup")
      return "shown" as const
    }
    if (existing !== null) {
      if (
        presentedResource?.scope !== scope ||
        presentedResource.petId !== state.pet ||
        presentedResource.identity !== identity
      )
        await command("reload", state.pet)
      await command("present", state.pet)
      return completeOpen()
    }
    const owned = assets.assets.snapshot().owned
    if (!options.trusted || !owned?.some((item) => item.vibemon_uuid === state.pet)) await assets.assets.getMyVibemons()
    if (!assets.assets.snapshot().owned?.some((item) => item.vibemon_uuid === state.pet))
      throw new Error("This account does not own the selected Vibemon")
    if (scope !== petScope()) throw new Error("The pet account changed")
    measure("ownership-ready")
    let ready!: () => void
    let fail!: (error: Error) => void
    const prepared = new Promise<void>((res, rej) => {
      ready = res
      fail = rej
    })
    const stop = await listen<{ petId: string }>("vibemon:ready", ({ payload }) => {
      if (payload.petId === state.pet) ready()
    })
    const timer = setTimeout(() => fail(new Error("The selected pet could not render")), 18_000)
    try {
      await Promise.all([
        prepared,
        (async () => {
          await petWindowCall("create-bubble")
          if (!(await petWindowCall<boolean>("create-pet"))) ready()
        })()
      ])
      measure("window-ready")
      if (scope !== petScope()) throw new Error("The pet account changed")
      await command("present", state.pet)
      return await completeOpen()
    } catch (error) {
      await petWindowCall("destroy-pet")
      throw error
    } finally {
      clearTimeout(timer)
      stop()
    }
  }
  async function closePet() {
    if (await WebviewWindow.getByLabel("vibemon")) await command("close", (await getVibemonState()).pet)
    // Keep the suspended renderer for the next explicit presentation.
    await updateVibemonState({ enabled: false, position: null })
  }
  const windows: PetWindowHost = {
    ...createPetWindowClient(),
    openPet: (options = {}) => serialize(() => ensurePet(options)),
    closePet: () => serialize(closePet),
    openRecharge: openPlatformAccount
  }
  configureVibemon({
    sessionIcons,
    ...assets,
    sessions: { ...owner, openChat: (binding) => owner.openChat(binding) },
    windows,
    onResourceSyncError: (error, context) =>
      logBackgroundError(`pet-sync/${context.phase}/${context.petId ?? "catalog"}`, error),
    resourcesSynchronized: (updated) => {
      const scope = petScope()
      return serialize(() =>
        restoreInBackground(async () => {
          if (scope !== petScope()) return
          await refreshSettings()
          const state = await getVibemonState()
          if (!state.enabled || !state.pet) return
          if (await WebviewWindow.getByLabel("vibemon")) {
            if (updated.has(state.pet)) await command("reload", state.pet)
          } else if (owner.snapshot()?.surfaceVisible !== true && (await assets.assets.resources.inspect(state.pet)))
            await ensurePet()
        })
      )
    },
    onError: report
  })
  await initializeSettings()
  async function handle(request: PetRequest) {
    const payload = request.payload as {
      binding: PetBinding
      requestId: string
      text: string
      token: string
      optionId: string
      label: "main" | "chat"
      sessionId: string | null
      visible: boolean
      trusted?: boolean
    }
    switch (request.action) {
      case "sync-resources":
        void syncVibemonResources()
        return null
      case "inspect":
        await owner.refresh()
        return owner.snapshot()
      case "send":
        return owner.send(payload.binding, payload.requestId, payload.text)
      case "answer":
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
          throw new Error("The pet conversation changed")
        if (
          request.action === "dismiss-result" &&
          (value.prompt !== null || (value.state !== "done" && value.state !== "idle"))
        )
          return
        await command(
          request.action === "bubble-interact" ? "bubble-interact" : "bubble-close",
          (await getVibemonState()).pet
        )
        return
      }
      case "surface": {
        if (payload.label !== request.from || !["main", "chat"].includes(payload.label))
          throw new Error("Invalid conversation surface")
        return owner.surface(payload.label, { sessionId: payload.sessionId, visible: payload.visible })
      }
      case "open-pet":
        return windows.openPet({ trusted: payload.trusted === true })
      case "close-pet":
        return windows.closePet()
      case "recharge":
        return windows.openRecharge()
      case "hide-pet":
        return serialize(async () => {
          if (await WebviewWindow.getByLabel("vibemon")) await command("suspend", "")
        })
      case "restore-pet":
        return serialize(async () => {
          await refreshSettings()
          if ((await getVibemonState()).pet) await ensurePet()
        })
      case "collapse": {
        if (request.from !== "chat") throw new Error("Only chat can collapse to a pet")
        return serialize(async () => {
          const chat = await WebviewWindow.getByLabel("chat")
          if (chat === null) throw new Error("Chat window unavailable")
          return collapseToPet({
            validate() {
              if (Date.now() >= request.deadline || request.scope !== petScope())
                throw new Error("Vibemon request expired")
              owner.requireSurface("chat", payload.sessionId)
            },
            async equippedPet() {
              await refreshSettings()
              return (await getVibemonState()).pet
            },
            hasPets: async () => (await assets.assets.getMyVibemons()).length > 0,
            async showPet() {
              if ((await ensurePet({ trusted: true })) !== "shown")
                throw new Error("Desktop pets are unavailable on this platform")
            },
            bindSession: () => owner.collapse(payload.sessionId),
            openBubble: async () => command("bubble-open", (await getVibemonState()).pet),
            async hideChat() {
              await chat.hide()
              await syncChatWindowSurface()
              await owner.surface("chat", { sessionId: payload.sessionId, visible: false })
            },
            restoreChat: () => openChatWindow()
          })
        })
      }
      default:
        throw new Error("Unsupported Vibemon request")
    }
  }
  await servePetRequests(handle)
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
    void windows.closePet().catch(report)
  })
  await listen("tray:toggle-pet", () => {
    void serialize(async () => {
      const pet = await WebviewWindow.getByLabel("vibemon")
      if (pet !== null && (await pet.isVisible())) await closePet()
      else await ensurePet()
    })
      .catch(async (error) => {
        await commands.showMainWindow()
        report(error)
      })
      .catch(report)
  })
  await commands.trayPetReady()
  function currentAccount() {
    return assets.account() === null ? null : petScope()
  }
  function restoreInBackground(work: () => Promise<unknown>) {
    return runPetRestoration(work, currentAccount, () => {
      void serialize(() => restoreInBackground(() => ensurePet()))
    })
  }
  const restore = async () => {
    if (usePlatformAuth.getState().isLoading) return
    if (assets.account() !== null) void syncVibemonResources()
    let restored = false
    try {
      await restoreInBackground(async () => {
        restored = await restorePetOnStartup(ensurePet, currentAccount)
      })
    } finally {
      await commands.autostartComplete({ restored })
    }
  }
  usePlatformAuth.subscribe((state, previous) => {
    if (state.user?.user_uuid !== previous.user?.user_uuid || (previous.isLoading && !state.isLoading)) {
      owner.invalidate()
      observeResourceSync("idle")
      toast.dismiss("pet-startup")
      void serialize(async () => {
        await petWindowCall("destroy-pet")
        await restore()
      }).catch(report)
    }
  })
  void serialize(restore).catch(report)
}
