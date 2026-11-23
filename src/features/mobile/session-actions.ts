import type { AppState, CodexClient, PendingAction } from "@alwith/module-chat/client"
import { inSessionTree, isFormElicitation } from "@alwith/module-chat/client"
import { elicitationFields, isAnswered } from "@alwith/module-chat/schema-elicitation-form"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

import { reportBackgroundError } from "@/lib/background-errors"
import { text } from "@/lib/text"

import { confirmedActionWrite, expireActionWrites } from "./reply-confirmation"

type Answer = Parameters<CodexClient["respond"]>[1]
type Address = { deviceId: string; sessionId: string }
type ActionAddress = Address & { actionId: string; epoch: string; clientRequestId: string }
type Response = ActionAddress & { answer: Answer }
type Host = Pick<CodexClient, "respond" | "state" | "store">
type Result = { status: "accepted" | "rejected" | "stale" | "unknown"; error: string | null }
type Receipt = { completion: Promise<Result>; outcome?: Result }

function roots(state: AppState, actions: PendingAction[]): Set<string> {
  const ids = new Set<string>()
  for (const action of actions) {
    let id = action.sessionId
    while (id && !ids.has(id)) {
      ids.add(id)
      id = state.sessions[id]?.subagent?.parentId ?? null
    }
  }
  return ids
}

function validAnswer(action: PendingAction, answer: Answer): boolean {
  if (!answer || typeof answer !== "object") return false
  if (action.kind === "permission") {
    if (
      !("outcome" in answer) ||
      !answer.outcome ||
      typeof answer.outcome !== "object" ||
      !("outcome" in answer.outcome)
    )
      return false
    const choice = answer.outcome
    return (
      choice.outcome === "cancelled" ||
      (choice.outcome === "selected" &&
        "optionId" in choice &&
        action.params.options.some((option) => option.optionId === choice.optionId))
    )
  }
  if (!("action" in answer)) return false
  if (answer.action === "cancel" || answer.action === "decline") return true
  if (answer.action !== "accept" || !isFormElicitation(action.params)) return false
  const fields = action.params.requestedSchema
  const candidate = answer.content ?? {}
  if (typeof candidate !== "object" || Array.isArray(candidate)) return false
  const content: Record<string, unknown> = Object.fromEntries(Object.entries(candidate))
  if (fields.required?.some((key) => !Object.hasOwn(content, key))) return false
  if (Object.keys(content).some((key) => !Object.hasOwn(fields.properties, key))) return false
  return elicitationFields(fields).every((field) => {
    if (!Object.hasOwn(content, field.key)) return !field.required
    const value = content[field.key]
    const property = field.property
    if (!isAnswered(field, value)) return false
    if (property.type === "boolean") return typeof value === "boolean"
    if (property.type === "array")
      return (
        Array.isArray(value) &&
        value.every(
          (entry) =>
            typeof entry === "string" &&
            (!field.multiOptions || field.multiOptions.some((option) => option.value === entry))
        )
      )
    if (property.type === "string")
      return typeof value === "string" && (!field.options || field.options.some((option) => option.value === value))
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (property.type === "number" || (property.type === "integer" && Number.isSafeInteger(value)))
    )
  })
}

export async function initializeSessionActions(client: Host): Promise<void> {
  let epoch = crypto.randomUUID()
  let revision = 0
  // A repeated upstream JSON-RPC id after removal gets a different mobile action id.
  const identities = new Map<string, { wireId: string; params: PendingAction["params"] }>()
  const inFlight = new Map<string, PendingAction>()
  const receipts = new Map<string, Receipt>()
  // Another Runtime client can answer while the chat store still contains the action.
  const resolved = new Set<string>()
  const retired = new WeakSet<PendingAction["params"]>()
  const actionable = (action: PendingAction): boolean => !resolved.has(action.id) && !retired.has(action.params)
  const current = (): PendingAction[] => {
    const actions = [...client.state.actions]
    for (const [key, pending] of inFlight) {
      if (!actions.some((action) => action.id === key)) actions.push(pending)
    }
    return actions.filter(actionable)
  }
  const syncIds = (actions: PendingAction[]): void => {
    const keys = new Set(actions.map((action) => action.id))
    for (const key of identities.keys()) if (!keys.has(key)) identities.delete(key)
    for (const action of actions) {
      if (identities.get(action.id)?.params !== action.params) {
        identities.set(action.id, { wireId: crypto.randomUUID(), params: action.params })
      }
    }
  }
  const publish = async (
    sessionId: string,
    deviceId: string | null,
    requestId: string | null = null
  ): Promise<void> => {
    const actions = current()
    syncIds(actions)
    const visible = actions.filter((action) => inSessionTree(client.state.sessions, sessionId, action.sessionId))
    await invoke("plugin:alwith-mobile|bridge_session_actions", {
      deviceId,
      sessionId,
      requestId,
      epoch,
      revision,
      error: null,
      actions: visible.map((action) => ({ ...action, id: identities.get(action.id)!.wireId }))
    })
  }
  const broadcast = (ids: Set<string>): void => {
    revision++
    for (const id of ids)
      void publish(id, null).catch((error: unknown) => reportBackgroundError("mobile-actions", error))
  }
  const respond = async (request: Response): Promise<Result> => {
    const action = client.state.actions.find(
      (item) =>
        actionable(item) && identities.get(item.id)?.wireId === request.actionId && item.sessionId === request.sessionId
    )
    if (request.epoch !== epoch || !action || inFlight.has(action.id)) return { status: "stale", error: null }
    if (!validAnswer(action, request.answer)) return { status: "rejected", error: "Invalid answer for this request" }
    inFlight.set(action.id, action)
    try {
      await confirmedActionWrite(action.id, () => client.respond(action.id, request.answer))
      return { status: "accepted", error: null }
    } catch (error: unknown) {
      return { status: "unknown", error: text(error) }
    } finally {
      if (inFlight.get(action.id) === action) {
        inFlight.delete(action.id)
        broadcast(roots(client.state, [action]))
      }
    }
  }
  await listen<{ actionId: string }>("mobile:action-resolved", ({ payload: { actionId } }) => {
    const affected = current().filter((action) => action.id === actionId)
    resolved.add(actionId)
    for (const action of affected) retired.add(action.params)
    identities.delete(actionId)
    if (affected.length) broadcast(roots(client.state, affected))
  })
  await listen<{ actionId: string }>("mobile:action-opened", ({ payload: { actionId } }) => {
    if (resolved.delete(actionId)) {
      // Identity events precede the batched ACP frames. Hide a retained previous
      // store object until the new request's own params reach the reducer.
      for (const action of client.state.actions) if (action.id === actionId) retired.add(action.params)
    }
  })
  await listen<Address & { requestId?: string }>("bridge:get-session-actions", ({ payload }) => {
    void publish(payload.sessionId, payload.deviceId, payload.requestId ?? null)
      .catch(async (error: unknown) => {
        reportBackgroundError("mobile-actions", error)
        if (payload.requestId) {
          await invoke("plugin:alwith-mobile|bridge_session_actions", {
            ...payload,
            epoch,
            revision,
            actions: [],
            error: text(error) || "Unable to synchronize session actions"
          })
        }
      })
      .catch((error: unknown) => reportBackgroundError("mobile-actions-reply", error))
  })
  const receiptKey = (address: ActionAddress): string =>
    JSON.stringify([address.epoch, address.deviceId, address.sessionId, address.actionId, address.clientRequestId])
  const sendResult = (address: ActionAddress, outcome: Result | { status: "pending"; error: null }): Promise<void> =>
    invoke("plugin:alwith-mobile|bridge_action_result", { ...address, ...outcome })
  await listen<ActionAddress>("bridge:action-status", ({ payload }) => {
    const receipt = receipts.get(receiptKey(payload))
    void sendResult(payload, receipt?.outcome ?? { status: receipt ? "pending" : "unknown", error: null }).catch(
      (error: unknown) => reportBackgroundError("mobile-action-result", error)
    )
  })
  await listen<Response>("bridge:action-response", ({ payload }) => {
    const { answer: _answer, ...address } = payload
    const key = receiptKey(address)
    let receipt = receipts.get(key)
    if (!receipt) {
      const entry: Receipt = {
        completion: respond(payload).then((outcome) => {
          entry.outcome = outcome
          return outcome
        })
      }
      if (receipts.size >= 256) receipts.delete(receipts.keys().next().value!)
      receipts.set(key, entry)
      receipt = entry
    }
    void receipt.completion
      .then((outcome) => sendResult(address, outcome))
      .catch((error: unknown) => reportBackgroundError("mobile-action-result", error))
  })
  let previousRoots = roots(client.state, current())
  client.store.subscribe((state, previous) => {
    if (state.connection !== previous.connection && state.connection !== "ready") {
      expireActionWrites()
      epoch = crypto.randomUUID()
      identities.clear()
      inFlight.clear()
      receipts.clear()
      resolved.clear()
    } else if (state.actions === previous.actions && state.sessions === previous.sessions) return
    const actions = current()
    const next = roots(state, actions)
    if (
      state.actions === previous.actions &&
      state.connection === previous.connection &&
      next.size === previousRoots.size &&
      [...next].every((id) => previousRoots.has(id))
    )
      return
    syncIds(actions)
    broadcast(new Set([...previousRoots, ...next]))
    previousRoots = next
  })
}
