import {
  configureVibemon,
  getVibemonState,
  initializeSettings,
  refreshSettings,
  updateVibemonState,
  syncVibemonResources,
  type PetBinding,
  type PetWindowHost
} from "@alwith/module-vibemon"
import { invoke } from "@tauri-apps/api/core"
import { emitTo, listen } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { platform } from "@tauri-apps/plugin-os"
import { toast } from "sonner"
import { runStateSource } from "@/agent/run-state-source"
import { openPlatformAccount } from "@/features/auth/open-account"
import { createPlatformPetAssets } from "@/features/auth/pet-assets"
import { usePlatformAuth } from "@/features/auth/store"
import { exportDraft } from "@/features/chat/composer/drafts"
import { openChatWindow } from "@/lib/chat-window"
import { client } from "@/lib/client"
import { CODEX_AGENT_ID, runtimeClient } from "@/lib/runtime"
import { createPetSessionOwner, type PetSurface } from "./session-host"
import { petScope, servePetRequests, type PetRequest } from "./transport"
import { createPetWindowClient, petWindowCall } from "./window-client"

const report = (failure: unknown) => toast.error(failure instanceof Error ? failure.message : String(failure))
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
    agentForSession: async id => (await runtimeClient()).agentForSession(id),
    claim: (requestId, binding, expectedOwner) =>
      invoke("vibemon_claim", {
        requestId,
        scope: `${petScope()}/${binding.connectionEpoch}`,
        sessionId: binding.sessionId,
        owner: expectedOwner
      }),
    prompt: (id, content) => client.prompt(id, content),
    respond: (token, answer) => client.respond(token, answer),
    async openChat(id) {
      if (id === null) await openChatWindow()
      else {
        const session = client.state.sessions[id]
        if (session === undefined) throw new Error("Open this conversation from the thread list")
        await openChatWindow({ sessionId: id, cwd: session.cwd, draft: await exportDraft(id) })
      }
      if (await WebviewWindow.getByLabel("vibemon")) await command("suspend", "")
    }
  })
  setMainSurface = value => owner.surface("main", value)
  let queue: Promise<unknown> = Promise.resolve()
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work)
    queue = result.catch(() => {})
    return result
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
      await emitTo("vibemon", "vibemon:command", { type, petId, requestId })
      await done
    } finally {
      clearTimeout(timer)
      stop()
    }
  }
  async function ensurePet() {
    if (platform() !== "macos" && platform() !== "windows") return "unavailable" as const
    const scope = petScope()
    await refreshSettings()
    const state = await getVibemonState()
    if (!state.pet) throw new Error("Select a Vibemon in the pet center first")
    await assets.assets.restoreOwned()
    const owned = assets.assets.snapshot().owned
    if (!owned?.some(item => item.vibemon_uuid === state.pet)) await assets.assets.getMyVibemons()
    if (!assets.assets.snapshot().owned?.some(item => item.vibemon_uuid === state.pet))
      throw new Error("This account does not own the selected Vibemon")
    if (!(await assets.assets.resources.cached(state.pet))) await assets.assets.ensureResource(state.pet)
    if (scope !== petScope()) throw new Error("The pet account changed")
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
      await petWindowCall("create-bubble")
      const created = await petWindowCall<boolean>("create-pet")
      if (created) await prepared
      if (scope !== petScope()) throw new Error("The pet account changed")
      await command("present", state.pet)
      if (scope !== petScope() || (await getVibemonState()).pet !== state.pet)
        throw new Error("The selected pet changed during presentation")
      await updateVibemonState({ enabled: true })
      return "shown" as const
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
    await updateVibemonState({ enabled: false, position: null })
    await petWindowCall("destroy-pet")
  }
  const windows: PetWindowHost = {
    ...createPetWindowClient(),
    openPet: () => serialize(ensurePet),
    closePet: () => serialize(closePet),
    openRecharge: openPlatformAccount
  }
  configureVibemon({
    ...assets,
    sessions: { ...owner, openChat: binding => owner.openChat(binding) },
    windows,
    resourcesSynchronized: updated => {
      const scope = petScope()
      return serialize(async () => {
        if (scope !== petScope()) return
        await refreshSettings()
        const state = await getVibemonState()
        if (!state.enabled || !state.pet) return
        if (await WebviewWindow.getByLabel("vibemon")) {
          if (updated.has(state.pet)) await command("reload", state.pet)
        } else if (owner.snapshot()?.surfaceVisible !== true) await ensurePet()
      })
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
      case "surface": {
        if (payload.label !== request.from || !["main", "chat"].includes(payload.label))
          throw new Error("Invalid conversation surface")
        return owner.surface(payload.label, { sessionId: payload.sessionId, visible: payload.visible })
      }
      case "open-pet":
        return windows.openPet()
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
          if ((await getVibemonState()).enabled) await ensurePet()
        })
      case "collapse": {
        if (request.from !== "chat") throw new Error("Only chat can collapse to a pet")
        return serialize(async () => {
          await owner.collapse(payload.sessionId)
          if ((await ensurePet()) !== "shown") throw new Error("Desktop pets are unavailable on this platform")
          const chat = await WebviewWindow.getByLabel("chat")
          if (chat === null) throw new Error("Chat window unavailable")
          await chat.hide()
          await owner.surface("chat", { sessionId: payload.sessionId, visible: false })
          await command("bubble-open", (await getVibemonState()).pet)
        })
      }
      default:
        throw new Error("Unsupported Vibemon request")
    }
  }
  await servePetRequests(handle)
  owner.subscribe(value => {
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
  const restore = async () => {
    if (assets.account() === null) return
    void syncVibemonResources()
    await refreshSettings()
    if ((await getVibemonState()).enabled) await ensurePet()
  }
  usePlatformAuth.subscribe((state, previous) => {
    if (state.user?.user_uuid !== previous.user?.user_uuid) {
      owner.invalidate()
      void serialize(async () => {
        await petWindowCall("destroy-pet")
        await restore()
      }).catch(report)
    }
  })
  if (assets.account() !== null) void serialize(restore).catch(report)
}
