import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import {
  type PetBinding,
  type PetObservation,
  type PetPanelLevel,
  type PetSessionChoice,
  type PetSurface,
  sameBinding
} from "@alwith/module-auth/pets/core"
import { isText, isToolCallSubject } from "@nyssance/codex-acp-v2/client"

import type { AppState } from "@/agent/client"

import { petAnswer, petPrompt } from "./pet-prompt"

export interface PetSessionOwner {
  state: () => AppState
  agentId: string
  source(): "snapshot" | "event"
  agentForSession(id: string): Promise<string | null>
  claim(requestId: string, binding: PetBinding, owner: string): Promise<boolean>
  prompt(id: string, content: acp.ContentBlock[]): Promise<void>
  cancel(id: string): Promise<void>
  markRead(id: string): Promise<void>
  respond(token: string, answer: acp.RequestPermissionResponse | acp.CreateElicitationResponse): void
  openChat(id: string | null, windowLabel: "main" | "chat"): Promise<void>
}
export type { PetSurface } from "@alwith/module-auth/pets/core"

/** A transient projection of the existing client. It never attaches or owns a session. */
export function createPetSessionOwner(owner: PetSessionOwner) {
  let epoch = crypto.randomUUID()
  let connection = owner.state().connection
  let bindingRevision = 0
  let revision = 0
  const signatures = new Map<string, string>()
  const agents = new Map<string, string | null>()
  let observations: PetObservation[] = []
  const bindings = new Map<string, PetBinding>()
  const hidden = new Set<string>()
  const stopping = new Set<string>()
  const answered = new Set<string>()
  const stopped = new Set<string>()
  const orders = new Map<string, number>()
  const promptOrders = new Map<string, number>()
  const completions = new Map<string, string>()
  const userMessages = new Map<string, string>()
  const previousStates = new Map<string, string>()
  const attachments = new Map<string, boolean>()
  const incarnations = new Map<string, string>()
  const surfaces: Record<"main" | "chat", PetSurface> = {
    main: { sessionId: null, visible: false },
    chat: { sessionId: null, visible: false }
  }
  let panel: PetPanelLevel = "hidden"
  let focusedSessionId: string | undefined
  let mainMinimized = false
  let selected: string | null = null
  let snapshot: PetObservation | null = null
  let sequence = 0
  let order = 0
  const listeners = new Set<(value: PetObservation | null) => void>()
  function candidates(state: AppState): PetSessionChoice[] {
    return Object.values(state.runStates)
      .filter((run) => !run.reusableDraft)
      .map((run) => ({
        sessionId: run.sessionId,
        title: state.sessions[run.sessionId]?.title ?? run.title,
        cwd: state.sessions[run.sessionId]?.cwd ?? run.cwd ?? "",
        windowLabel: state.sessionWindows[run.sessionId] ?? "main"
      }))
  }
  function publish(value: PetObservation | null) {
    snapshot = value
    for (const listener of listeners) listener(value)
  }
  async function refresh() {
    const current = ++sequence
    const state = owner.state()
    const source = owner.source()
    if (state.connection !== connection) {
      connection = state.connection
      epoch = crypto.randomUUID()
      signatures.clear()
      bindings.clear()
      agents.clear()
      incarnations.clear()
      attachments.clear()
      userMessages.clear()
      previousStates.clear()
      completions.clear()
      answered.clear()
      stopping.clear()
    }
    if (state.connection !== "ready") {
      observations = []
      publish(null)
      return
    }
    const choices = candidates(state)
    const ids = new Set(choices.map((choice) => choice.sessionId))
    if (focusedSessionId !== undefined && !ids.has(focusedSessionId)) {
      focusedSessionId = undefined
      panel = "hidden"
    }
    for (const map of [
      signatures,
      bindings,
      agents,
      incarnations,
      attachments,
      userMessages,
      previousStates,
      completions,
      orders
    ])
      for (const id of map.keys()) if (!ids.has(id)) map.delete(id)
    for (const id of hidden) if (!ids.has(id)) hidden.delete(id)
    const actionIds = new Set(state.actions.map((action) => action.id))
    for (const token of answered) if (!actionIds.has(token)) answered.delete(token)
    for (const token of promptOrders.keys()) if (!actionIds.has(token)) promptOrders.delete(token)
    for (const action of state.actions) if (!promptOrders.has(action.id)) promptOrders.set(action.id, ++order)
    const make = (choice: PetSessionChoice): PetObservation => {
      const id = choice.sessionId
      const run = state.runStates[id]
      const session = state.sessions[id]
      const previous = previousStates.get(id)
      const userId = session?.items.findLast((item) => item.kind === "user")?.id
      const newTurn = userId !== undefined && userMessages.has(id) && userMessages.get(id) !== userId
      if (userId !== undefined) userMessages.set(id, userId)
      if (!orders.has(id) || newTurn || (run.state === "running" && (previous === "idle" || previous === "done"))) {
        orders.set(id, run.since)
        hidden.delete(id)
        completions.delete(id)
        stopped.delete(id)
      }
      if (run.state === "done" && previous !== "done") completions.set(id, `${epoch}/${run.since}`)
      if (stopping.has(id) && run.state !== "running" && run.state !== "requires_action") {
        stopping.delete(id)
        stopped.add(id)
        completions.set(id, `${epoch}/stopped/${run.since}`)
      }
      previousStates.set(id, run.state)
      const attached = session?.attached === true
      if (attachments.has(id) && attachments.get(id) !== attached) incarnations.delete(id)
      attachments.set(id, attached)
      let incarnation = incarnations.get(id)
      if (incarnation === undefined) {
        incarnation = crypto.randomUUID()
        incarnations.set(id, incarnation)
      }
      const nextSignature = `${epoch}/${incarnation}/${run.owner}/${run.executionId}`
      const changed = signatures.get(id) !== nextSignature
      if (changed) {
        agents.delete(id)
        signatures.set(id, nextSignature)
        bindings.set(id, {
          connectionEpoch: epoch,
          agentId: agents.get(id) ?? owner.agentId,
          sessionId: id,
          incarnation,
          bindingRevision: ++bindingRevision
        })
      }
      const binding = bindings.get(id)
      if (binding === undefined) throw new Error("Pet binding unavailable")
      const action =
        state.actions.findLast((item) => item.sessionId === id && item.kind === "permission") ??
        state.actions.findLast((item) => item.sessionId === id)
      const subject = action?.kind === "permission" ? action.params.subject : null
      const tool = subject != null && isToolCallSubject(subject) ? subject.toolCall : null
      const storedTool =
        tool === null ? undefined : session?.items.find((item) => item.id === tool.toolCallId && item.kind === "tool")
      const prompt = petPrompt(
        action,
        tool?.rawInput !== undefined ? tool.rawInput : storedTool?.kind === "tool" ? storedTool.rawInput : undefined
      )
      const last = session?.items.findLast((item) => item.kind === "assistant")
      const reply =
        last?.kind === "assistant"
          ? {
              messageId: last.id,
              text: last.content
                .filter(isText)
                .map((block) => block.text)
                .join("")
            }
          : null
      const user = session?.items.findLast((item) => item.kind === "user")
      const agent = agents.get(id)
      return {
        binding,
        source: changed ? "snapshot" : source,
        revision: revision + 1,
        hidden: hidden.has(id),
        stopped: stopped.has(id),
        order: orders.get(id),
        promptOrder: action === undefined ? undefined : promptOrders.get(action.id),
        completion: completions.get(id),
        state: run.state,
        since: run.since,
        title: session?.title ?? run.title,
        cwd: session?.cwd ?? run.cwd ?? "",
        windowLabel: choice.windowLabel,
        candidates: choices,
        owner: run.owner,
        executionId: run.executionId,
        executionRole: run.executionRole,
        access:
          agent !== owner.agentId || session === undefined || !session.attached || session.restoring
            ? "unavailable"
            : session.readOnly || run.executionId !== null
              ? "readOnly"
              : "writable",
        surfaceVisible: Object.values(surfaces).some((surface) => surface.visible && surface.sessionId === id),
        error: session?.error?.stopReason ?? null,
        reply,
        userMessage:
          user?.kind === "user"
            ? {
                messageId: user.id,
                text: user.content
                  .filter(isText)
                  .map((block) => block.text)
                  .join(""),
                timestamp: user.at
              }
            : null,
        prompt
      }
    }
    const publishAll = () => {
      const tasks = choices.map(make)
      observations = tasks
      const primary = tasks.find((task) => task.binding.sessionId === selected) ?? tasks[0]
      if (primary === undefined) {
        publish(null)
        return
      }
      const active = tasks.filter(
        (task) =>
          task.binding.sessionId === focusedSessionId ||
          task.state !== "idle" ||
          task.error !== null ||
          task.prompt !== null ||
          task.stopped
      )
      publish({ ...primary, revision: ++revision, taskFeed: { tasks: active, mainMinimized, panel, focusedSessionId } })
    }
    // Publish transitions synchronously before resolving ownership, including done -> idle.
    publishAll()
    const resolved = await Promise.all(
      choices
        .filter((choice) => !agents.has(choice.sessionId))
        .map(async (choice) => [choice.sessionId, await owner.agentForSession(choice.sessionId)] as const)
    )
    if (sequence !== current) return
    let changed = false
    for (const [id, agent] of resolved) {
      if (agents.get(id) !== agent) {
        agents.set(id, agent)
        changed = true
      }
    }
    if (changed) publishAll()
  }
  function requireBinding(binding: PetBinding): PetObservation {
    const value = observations.find((task) => sameBinding(task.binding, binding))
    if (value === undefined) throw new Error("The pet conversation changed; open the conversation before retrying")
    const state = owner.state()
    const run = state.runStates[binding.sessionId]
    if (run?.owner !== value.owner || run.executionId !== value.executionId || state.connection !== "ready")
      throw new Error("The pet conversation is unavailable")
    return value
  }
  async function claim(binding: PetBinding, requestId: string): Promise<PetObservation> {
    await refresh()
    const current = requireBinding(binding)
    if (current.access !== "writable" || current.executionId !== null)
      throw new Error("This conversation is read-only; open it to continue")
    if ((await owner.agentForSession(binding.sessionId)) !== owner.agentId)
      throw new Error("This conversation is read-only; the execution owner changed")
    if (!(await owner.claim(requestId, binding, current.owner)))
      throw new Error("This pet request was already submitted; check the conversation")
    const latest = requireBinding(binding)
    const session = owner.state().sessions[binding.sessionId]
    if (!session?.attached || session.readOnly || session.restoring)
      throw new Error("The conversation is no longer writable")
    return latest
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
      surfaces[label] = value
      return refresh()
    },
    collapse(sessionId: string | null) {
      selected = sessionId
      focusedSessionId = sessionId ?? undefined
      panel = sessionId === null ? "hidden" : "expanded"
      if (sessionId !== null) hidden.delete(sessionId)
      return refresh()
    },
    requireSurface(label: "main" | "chat", sessionId: string | null) {
      if (!surfaces[label].visible || surfaces[label].sessionId !== sessionId)
        throw new Error("The conversation window changed during pet presentation")
    },
    async select(binding: PetBinding, sessionId: string) {
      await refresh()
      requireBinding(binding)
      if (!candidates(owner.state()).some((item) => item.sessionId === sessionId))
        throw new Error("The conversation is no longer current")
      selected = sessionId
      await refresh()
    },
    invalidate() {
      sequence++
      epoch = crypto.randomUUID()
      signatures.clear()
      bindings.clear()
      agents.clear()
      hidden.clear()
      stopping.clear()
      answered.clear()
      stopped.clear()
      orders.clear()
      previousStates.clear()
      completions.clear()
      promptOrders.clear()
      incarnations.clear()
      attachments.clear()
      userMessages.clear()
      selected = null
      focusedSessionId = undefined
      panel = "hidden"
      observations = []
      publish(null)
    },
    minimized(value: boolean) {
      mainMinimized = value
      return refresh()
    },
    panel(level: PetPanelLevel) {
      if (!["hidden", "stacked", "expanded"].includes(level)) throw new Error("Invalid pet panel level")
      panel = level
      focusedSessionId = undefined
      return refresh()
    },
    async cancel(binding: PetBinding, requestId: string) {
      const value = await claim(binding, requestId)
      if (stopping.has(binding.sessionId)) return
      if (value.state !== "running") throw new Error("This conversation is not running")
      stopping.add(binding.sessionId)
      try {
        await owner.cancel(binding.sessionId)
      } catch (error) {
        stopping.delete(binding.sessionId)
        throw error
      }
      await refresh()
    },
    async dismiss(binding: PetBinding) {
      const value = requireBinding(binding)
      if (hidden.has(binding.sessionId)) return
      hidden.add(binding.sessionId)
      try {
        if (value.state === "done") await owner.markRead(binding.sessionId)
      } catch (error) {
        hidden.delete(binding.sessionId)
        await refresh()
        throw error
      }
      stopped.delete(binding.sessionId)
      if (focusedSessionId === binding.sessionId) {
        focusedSessionId = undefined
        panel = "hidden"
      }
      await refresh()
    },
    async send(binding: PetBinding, requestId: string, text: string) {
      if (!text.trim()) throw new Error("A reply cannot be empty")
      const value = await claim(binding, requestId)
      const state = owner.state()
      if (
        state.runStates[binding.sessionId]?.state === "running" ||
        state.actions.some((action) => action.sessionId === binding.sessionId) ||
        value.prompt !== null
      )
        throw new Error("This conversation is busy or requires an answer")
      await owner.prompt(binding.sessionId, [{ type: "text", text }])
    },
    async answer(binding: PetBinding, requestId: string, token: string, optionId: string) {
      if (!mainMinimized) throw new Error("Open the main window to answer this permission")
      const value = await claim(binding, requestId)
      if (answered.has(token)) return
      const action = owner.state().actions.find((item) => item.id === token && item.sessionId === binding.sessionId)
      if (
        !mainMinimized ||
        value.prompt?.kind !== "permission" ||
        value.prompt?.token !== token ||
        action === undefined ||
        !value.prompt.options.some((option) => option.id === optionId)
      )
        throw new Error("This permission request expired or changed")
      const answer = petAnswer(action, optionId)
      answered.add(token)
      try {
        owner.respond(token, answer)
      } catch (error) {
        answered.delete(token)
        throw error
      }
    },
    async openChat(binding: PetBinding | null) {
      await refresh()
      const value = binding === null ? null : requireBinding(binding)
      await owner.openChat(binding?.sessionId ?? null, value?.windowLabel ?? "chat")
    },
    async activate() {
      await owner.openChat(null, "chat")
    }
  }
}
