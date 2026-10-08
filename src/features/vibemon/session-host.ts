import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { isText } from "@alwith/api"
import { sameBinding, type PetBinding, type PetObservation } from "@alwith/module-vibemon"
import type { AppState } from "@/agent/client"

export interface PetSessionOwner {
  state(): AppState
  agentId: string
  source(): "snapshot" | "event"
  agentForSession(id: string): Promise<string | null>
  claim(requestId: string, binding: PetBinding, owner: string): Promise<boolean>
  prompt(id: string, content: acp.ContentBlock[]): Promise<void>
  respond(token: string, answer: acp.RequestPermissionResponse): void
  openChat(id: string | null): Promise<void>
}
export type PetSurface = { sessionId: string | null; visible: boolean }

/** A transient projection of the existing client. It never attaches or owns a session. */
export function createPetSessionOwner(owner: PetSessionOwner) {
  let epoch = crypto.randomUUID()
  let connection = owner.state().connection
  let bindingRevision = 0
  let revision = 0
  let signature = ""
  let manual: string | null = null
  const surfaces: Record<"main" | "chat", PetSurface> = {
    main: { sessionId: null, visible: false },
    chat: { sessionId: null, visible: false }
  }
  const incarnations = new Map<string, string>()
  let snapshot: PetObservation | null = null
  let sequence = 0
  const listeners = new Set<(value: PetObservation | null) => void>()
  function target(): string | null {
    return manual ?? surfaces.chat.sessionId ?? surfaces.main.sessionId
  }
  function publish(value: PetObservation | null) {
    snapshot = value
    for (const listener of listeners) listener(value)
  }
  async function refresh() {
    const current = ++sequence
    const state = owner.state()
    if (state.connection !== connection) {
      connection = state.connection
      epoch = crypto.randomUUID()
      signature = ""
      incarnations.clear()
    }
    for (const id of incarnations.keys()) if (!state.sessions[id]?.attached) incarnations.delete(id)
    const id = target()
    const run = id === null ? undefined : state.runStates[id]
    if (id === null || run === undefined || state.connection !== "ready") {
      signature = ""
      publish(null)
      return
    }
    const session = state.sessions[id]
    const agent = await owner.agentForSession(id)
    if (sequence !== current) return
    let incarnation = incarnations.get(id)
    if (incarnation === undefined) {
      incarnation = crypto.randomUUID()
      incarnations.set(id, incarnation)
    }
    const nextSignature = `${epoch}/${id}/${incarnation}/${run.owner}/${run.executionId}`
    const changed = signature !== nextSignature
    if (changed) {
      signature = nextSignature
      bindingRevision++
    }
    const action = state.actions.find(item => item.sessionId === id)
    const prompt =
      action?.kind === "permission"
        ? {
            token: action.id,
            title: action.params.title,
            options: action.params.options.map(option => ({ id: option.optionId, label: option.name }))
          }
        : null
    const last = session?.items.findLast(item => item.kind === "assistant")
    const reply =
      last?.kind === "assistant"
        ? last.content
            .filter(isText)
            .map(block => block.text)
            .join("")
        : null
    publish({
      binding: { connectionEpoch: epoch, agentId: agent ?? owner.agentId, sessionId: id, incarnation, bindingRevision },
      source: changed ? "snapshot" : owner.source(),
      revision: ++revision,
      state: run.state,
      since: run.since,
      title: session?.title ?? run.title,
      owner: run.owner,
      executionId: run.executionId,
      executionRole: run.executionRole,
      access:
        agent !== owner.agentId || session === undefined || !session.attached || session.restoring
          ? "unavailable"
          : session.readOnly || run.executionId !== null
            ? "readOnly"
            : "writable",
      surfaceVisible: Object.values(surfaces).some(surface => surface.visible && surface.sessionId === id),
      error: session?.error?.stopReason ?? null,
      reply,
      prompt
    })
  }
  function requireBinding(binding: PetBinding): PetObservation {
    if (snapshot === null || !sameBinding(snapshot.binding, binding))
      throw new Error("The pet conversation changed; open the conversation before retrying")
    const state = owner.state()
    const run = state.runStates[binding.sessionId]
    if (
      run?.owner !== snapshot.owner ||
      run.executionId !== snapshot.executionId ||
      binding.sessionId !== target() ||
      state.connection !== "ready"
    )
      throw new Error("The pet conversation is unavailable")
    return snapshot
  }
  async function claim(binding: PetBinding, requestId: string): Promise<PetObservation> {
    await refresh()
    const current = requireBinding(binding)
    if (current.access !== "writable" || current.executionId !== null)
      throw new Error("This conversation is read-only; open it to continue")
    if ((await owner.agentForSession(binding.sessionId)) !== owner.agentId)
      throw new Error("The execution owner changed")
    if (!(await owner.claim(requestId, binding, current.owner)))
      throw new Error("This pet request was already submitted; check the conversation")
    requireBinding(binding)
    return current
  }
  return {
    refresh,
    snapshot: () => snapshot,
    subscribe(listener: (value: PetObservation | null) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    surface(label: "main" | "chat", value: PetSurface) {
      const previous = surfaces[label]
      surfaces[label] = value
      if (manual !== null && previous.sessionId !== value.sessionId && value.visible && value.sessionId !== manual)
        manual = null
      return refresh()
    },
    collapse(sessionId: string | null) {
      manual = sessionId
      return refresh()
    },
    invalidate() {
      sequence++
      epoch = crypto.randomUUID()
      signature = ""
      incarnations.clear()
      manual = null
      publish(null)
    },
    async send(binding: PetBinding, requestId: string, text: string) {
      if (!text.trim()) throw new Error("A reply cannot be empty")
      const value = await claim(binding, requestId)
      const state = owner.state()
      if (
        state.runStates[binding.sessionId]?.state === "running" ||
        state.actions.some(action => action.sessionId === binding.sessionId) ||
        value.prompt !== null
      )
        throw new Error("This conversation is busy or requires an answer")
      await owner.prompt(binding.sessionId, [{ type: "text", text }])
    },
    async answer(binding: PetBinding, requestId: string, token: string, optionId: string) {
      const value = await claim(binding, requestId)
      const action = owner.state().actions.find(item => item.id === token && item.sessionId === binding.sessionId)
      if (
        value.prompt?.token !== token ||
        action?.kind !== "permission" ||
        !action.params.options.some(option => option.optionId === optionId)
      )
        throw new Error("This permission request expired or changed")
      owner.respond(token, { outcome: { outcome: "selected", optionId } })
    },
    async openChat(binding: PetBinding | null) {
      if (binding !== null) requireBinding(binding)
      await owner.openChat(binding?.sessionId ?? null)
    }
  }
}
