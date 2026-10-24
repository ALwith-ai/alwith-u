// Only main owns the ACP connection. The chat window receives projections and forwards
// a fixed set of actions; it never attaches an agent or persists another conversation.

import type { Session } from "@alwith/api"
import type { RealtimeEvent } from "@nyssance/codex-acp-v2/client"
import { emitTo, listen } from "@tauri-apps/api/event"

import { type AppState, CodexClient } from "@/agent/client"
import type { RateLimitSnapshot } from "@/agent/codex-extensions"
import { macProjectPaths } from "@/agent/project-path"
import { isMac } from "@/lib/platform"
import { asError } from "@/lib/text"

export type ChatEvents = { listen: typeof listen; emitTo: typeof emitTo }
const events: ChatEvents = { listen, emitTo }
const REQUEST = "chat:client-request"
const RESPONSE = "chat:client-response"
const STATE = "chat:client-state"
const LIMITS = "chat:client-limits"
const CLOSED = "chat:client-closed"
const REALTIME = "chat:client-realtime"
const METHODS = [
  "connect",
  "startRealtime",
  "stopRealtime",
  "newSession",
  "prepareDraft",
  "discardDraft",
  "transferDraft",
  "fork",
  "readThreadSummary",
  "listThreads",
  "open",
  "loadOlderHistory",
  "activityReply",
  "loadHistoryNavigation",
  "previewHistoryTurn",
  "loadHistoryTurn",
  "prompt",
  "promptReceipt",
  "retrySession",
  "cancel",
  "close",
  "stopSession",
  "setConfig",
  "respond",
  "readRateLimits",
  "requestPrediction",
  "fuzzyFileSearch",
  "renameSession",
  "delete"
] as const
type Method = (typeof METHODS)[number]
type Request = { connectionId: string; id: string; method: Method; args: unknown[] }
type Response = { connectionId: string; id: string; result?: unknown; error?: { message: string; code?: number } }
type Projection = {
  connectionId: string
  revision: number
  patch: Partial<AppState>
  reset: boolean
  removedSessions: string[]
}

/** Installed once by the authenticated main App. Listener readiness precedes opening a window. */
export async function serveChatClient(
  owner: CodexClient,
  transport: ChatEvents = events,
  onError: (error: unknown) => void = console.error
): Promise<() => void> {
  const realtime = new Map<string, () => void>()
  let connectionId: string | null = null
  let disposed = false
  let revision = 0
  let previous: AppState | null = null
  let publishing: Promise<void> | null = null
  let dirty = false
  const publish = (): Promise<void> => {
    if (disposed || connectionId === null) return Promise.resolve()
    dirty = true
    if (publishing !== null) return publishing
    const next = Promise.resolve().then(async () => {
      while (dirty && !disposed && connectionId !== null) {
        dirty = false
        const identity = connectionId
        const state = owner.state
        if (disposed || identity !== connectionId) return
        const patch: Partial<AppState> = {}
        for (const key of Object.keys(state) as (keyof AppState)[]) {
          if (key !== "sessions" && (previous === null ? true : state[key] !== previous[key]))
            Object.assign(patch, { [key]: state[key] })
        }
        const sessions = Object.fromEntries(
          Object.entries(state.sessions).filter(([id, session]) =>
            previous === null ? true : previous.sessions[id] !== session
          )
        )
        if (Object.keys(sessions).length > 0) patch.sessions = sessions
        const removedSessions =
          previous === null ? [] : Object.keys(previous.sessions).filter((id) => !(id in state.sessions))
        const payload: Projection = {
          connectionId: identity,
          revision: ++revision,
          patch,
          reset: previous === null,
          removedSessions
        }
        await transport.emitTo("chat", STATE, payload)
        if (identity === connectionId) previous = state
      }
    })
    // A failed delivery must not poison future updates. The next update sends a full snapshot.
    publishing = next
      .catch((error: unknown) => {
        previous = null
        throw error
      })
      .finally(() => {
        publishing = null
        if (dirty && !disposed && connectionId !== null) return publish()
      })
    return publishing
  }

  const stop = await transport.listen<Request>(
    REQUEST,
    ({ payload: request }) =>
      void (async () => {
        if (disposed) return
        let startedSession: string | undefined
        try {
          if (!METHODS.includes(request.method) || !Array.isArray(request.args)) throw new Error("Invalid chat action")
          if (request.method === "connect") {
            if (connectionId !== null && connectionId !== request.connectionId) {
              for (const [sessionId, unsubscribe] of realtime) {
                unsubscribe()
                await owner.stopRealtime(sessionId)
              }
              realtime.clear()
            }
            connectionId = request.connectionId
            previous = null
          } else if (request.connectionId !== connectionId) throw new Error("Chat window connection expired")
          if (request.method === "startRealtime") {
            const sessionId = request.args[0]
            if (typeof sessionId !== "string") throw new Error("Invalid voice session")
            if (realtime.has(sessionId)) throw new Error("A voice call already owns this session")
            const identity = connectionId
            startedSession = sessionId
            realtime.set(
              sessionId,
              owner.onRealtime(sessionId, (event) => {
                if (disposed || identity !== connectionId) return
                void transport.emitTo("chat", REALTIME, { connectionId: identity, event }).catch(onError)
                if (event.event === "closed" || event.event === "disconnected") {
                  realtime.get(sessionId)?.()
                  realtime.delete(sessionId)
                }
              })
            )
          }
          const action = Reflect.get(owner, request.method) as (...args: unknown[]) => unknown
          const result = await action.apply(owner, request.args)
          if (disposed || connectionId !== request.connectionId) return
          await publish()
          await transport.emitTo("chat", RESPONSE, { connectionId, id: request.id, result } satisfies Response)
        } catch (error) {
          if (disposed) return
          if (startedSession !== undefined) {
            realtime.get(startedSession)?.()
            realtime.delete(startedSession)
          }
          const code =
            typeof error === "object" && error !== null && "code" in error && typeof error.code === "number"
              ? error.code
              : undefined
          await transport.emitTo("chat", RESPONSE, {
            connectionId: request.connectionId,
            id: request.id,
            error: {
              message: error instanceof Error ? error.message : String(error),
              ...(code === undefined ? {} : { code })
            }
          } satisfies Response)
        }
      })()
  )
  const stopState = owner.store.subscribe(() => {
    void publish().catch(onError)
  })
  const stopLimits = owner.onRateLimits((limits) => {
    if (connectionId !== null) void transport.emitTo("chat", LIMITS, { connectionId, limits })
  })
  return () => {
    disposed = true
    stop()
    stopState()
    stopLimits()
    for (const [id, unsubscribe] of realtime) {
      unsubscribe()
      void owner.stopRealtime(id).catch(onError)
    }
    realtime.clear()
    void transport.emitTo("chat", CLOSED, { connectionId })
  }
}

export class RemoteChatClient extends CodexClient {
  private readonly transport: ChatEvents
  private connectionId = crypto.randomUUID()
  private ready: Promise<void> | null = null
  private stopListeners: (() => void)[] = []
  private revision = 0
  private readonly realtimeListeners = new Map<string, Set<(event: RealtimeEvent) => void>>()
  private readonly limitsListeners = new Set<(limits: RateLimitSnapshot) => void>()
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >()

  constructor(transport: ChatEvents = events) {
    super(
      () => {
        return Promise.try(() => {
          throw new Error("Chat window cannot own an agent connection")
        })
      },
      { agentId: "codex", launch: { engine: "codex" }, projectPaths: isMac() ? macProjectPaths : undefined }
    )
    this.transport = transport
  }

  override connect(): Promise<void> {
    const identity = this.connectionId
    this.ready ??= this.initialize()
    return this.ready.then(async () => {
      if (identity !== this.connectionId) throw new Error("Chat window disconnected")
      await this.request("connect", [])
    })
  }

  private async initialize(): Promise<void> {
    const identity = this.connectionId
    const stops = await Promise.all([
      this.transport.listen<Response>(RESPONSE, ({ payload }) => {
        if (payload.connectionId !== this.connectionId) return
        const pending = this.pending.get(payload.id)
        if (!pending) return
        this.pending.delete(payload.id)
        clearTimeout(pending.timer)
        if (payload.error) pending.reject(Object.assign(new Error(payload.error.message), { code: payload.error.code }))
        else pending.resolve(payload.result)
      }),
      this.transport.listen<{ connectionId: string; event: RealtimeEvent }>(REALTIME, ({ payload }) => {
        if (payload.connectionId !== this.connectionId) return
        const listeners = this.realtimeListeners.get(payload.event.sessionId)
        if (listeners !== undefined) for (const receive of listeners) receive(payload.event)
      }),
      this.transport.listen<Projection>(STATE, ({ payload }) => {
        if (payload.connectionId !== this.connectionId || payload.revision <= this.revision) return
        this.revision = payload.revision
        this.store.setState((state) => {
          const sessions = { ...(payload.reset ? {} : state.sessions), ...payload.patch.sessions }
          for (const id of payload.removedSessions) delete sessions[id]
          return { ...payload.patch, sessions }
        })
      }),
      this.transport.listen<{ connectionId: string; limits: RateLimitSnapshot }>(LIMITS, ({ payload }) => {
        if (payload.connectionId === this.connectionId)
          for (const listener of this.limitsListeners) listener(payload.limits)
      }),
      this.transport.listen<{ connectionId: string }>(CLOSED, ({ payload }) => {
        if (payload.connectionId === this.connectionId) this.disconnect()
      })
    ])
    if (identity !== this.connectionId) {
      for (const stop of stops) stop()
      throw new Error("Chat window disconnected")
    }
    this.stopListeners = stops
  }

  private request<M extends Method>(
    method: M,
    args: Parameters<CodexClient[M]>
  ): Promise<Awaited<ReturnType<CodexClient[M]>>> {
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      // This is a failure deadline, never a delay used to guess readiness. Do not retry writes.
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error("Main window did not answer the chat request"))
      }, 120_000)
      this.pending.set(id, { resolve: (value) => resolve(value as Awaited<ReturnType<CodexClient[M]>>), reject, timer })
      void this.transport
        .emitTo("main", REQUEST, { connectionId: this.connectionId, id, method, args } satisfies Request)
        .catch((error: unknown) => {
          clearTimeout(timer)
          this.pending.delete(id)
          reject(asError(error))
        })
    })
  }

  override disconnect(): void {
    for (const [sessionId, listeners] of this.realtimeListeners) {
      void this.request("stopRealtime", [sessionId]).catch((error) => console.error(error))
      for (const receive of listeners) receive({ sessionId, event: "disconnected", data: {} })
    }
    this.realtimeListeners.clear()
    this.connectionId = crypto.randomUUID()
    for (const stop of this.stopListeners.splice(0)) stop()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error("Chat window disconnected"))
    }
    this.pending.clear()
    this.ready = null
    this.revision = 0
    this.store.setState({
      connection: "disconnected",
      agent: null,
      sessions: {},
      historyPages: {},
      historyNavigation: {},
      actions: [],
      runStates: {},
      draftSessions: {},
      sessionWindows: {},
      configPending: {},
      threads: []
    })
  }

  override session(id: string): Session {
    const session = this.state.sessions[id]
    if (!session) throw new Error(`Unknown session: ${id}`)
    return session
  }
  override startRealtime(...args: Parameters<CodexClient["startRealtime"]>) {
    return this.request("startRealtime", args)
  }
  override stopRealtime(...args: Parameters<CodexClient["stopRealtime"]>) {
    return this.request("stopRealtime", args)
  }
  override onRealtime(sessionId: string, receive: (event: RealtimeEvent) => void): () => void {
    let listeners = this.realtimeListeners.get(sessionId)
    if (listeners === undefined) {
      listeners = new Set()
      this.realtimeListeners.set(sessionId, listeners)
    }
    listeners.add(receive)
    return () => {
      listeners.delete(receive)
      if (listeners.size === 0) this.realtimeListeners.delete(sessionId)
    }
  }
  override listThreads(...args: Parameters<CodexClient["listThreads"]>): Promise<void> {
    return this.request("listThreads", args)
  }
  override prepareDraft(...args: Parameters<CodexClient["prepareDraft"]>): Promise<string> {
    return this.request("prepareDraft", args)
  }
  override discardDraft(...args: Parameters<CodexClient["discardDraft"]>): Promise<void> {
    return this.request("discardDraft", args)
  }
  override transferDraft(...args: Parameters<CodexClient["transferDraft"]>): Promise<void> {
    return this.request("transferDraft", args)
  }
  override newSession(...args: Parameters<CodexClient["newSession"]>): Promise<string> {
    return this.request("newSession", [args[0], args[1] ?? null, "chat"])
  }
  override readThreadSummary(
    ...args: Parameters<CodexClient["readThreadSummary"]>
  ): ReturnType<CodexClient["readThreadSummary"]> {
    return this.request("readThreadSummary", args)
  }

  override fork(...args: Parameters<CodexClient["fork"]>): Promise<string> {
    return this.request("fork", args)
  }
  override open(...args: Parameters<CodexClient["open"]>): Promise<void> {
    return this.request("open", [args[0], args[1], "chat"])
  }
  override activityReply(...args: Parameters<CodexClient["activityReply"]>): Promise<string | null> {
    return this.request("activityReply", args)
  }
  override loadOlderHistory(...args: Parameters<CodexClient["loadOlderHistory"]>): Promise<void> {
    return this.request("loadOlderHistory", args)
  }
  override loadHistoryNavigation(...args: Parameters<CodexClient["loadHistoryNavigation"]>): Promise<void> {
    return this.request("loadHistoryNavigation", args)
  }
  override previewHistoryTurn(...args: Parameters<CodexClient["previewHistoryTurn"]>): Promise<void> {
    return this.request("previewHistoryTurn", args)
  }
  override loadHistoryTurn(...args: Parameters<CodexClient["loadHistoryTurn"]>): Promise<void> {
    return this.request("loadHistoryTurn", args)
  }
  override renameSession(...args: Parameters<CodexClient["renameSession"]>): Promise<void> {
    return this.request("renameSession", args)
  }
  override delete(...args: Parameters<CodexClient["delete"]>): Promise<void> {
    return this.request("delete", args)
  }
  override prompt(...args: Parameters<CodexClient["prompt"]>): Promise<void> {
    return this.request("prompt", args)
  }
  override promptReceipt(...args: Parameters<CodexClient["promptReceipt"]>): Promise<string> {
    return this.request("promptReceipt", args)
  }
  override retrySession(...args: Parameters<CodexClient["retrySession"]>): Promise<void> {
    return this.request("retrySession", args)
  }
  override cancel(...args: Parameters<CodexClient["cancel"]>): Promise<void> {
    return this.request("cancel", args)
  }
  override close(...args: Parameters<CodexClient["close"]>): Promise<void> {
    return this.request("close", args)
  }

  override stopSession(...args: Parameters<CodexClient["stopSession"]>): Promise<void> {
    return this.request("stopSession", args)
  }
  override setConfig(...args: Parameters<CodexClient["setConfig"]>): Promise<void> {
    return this.request("setConfig", [args[0], args[1], args[2], "chat"])
  }
  override respond(...args: Parameters<CodexClient["respond"]>): void {
    // Existing approval UI uses synchronous respond; surface asynchronous failures globally.
    void this.request("respond", args)
  }
  override requestPrediction(...args: Parameters<CodexClient["requestPrediction"]>): Promise<void> {
    return this.request("requestPrediction", args)
  }
  override readRateLimits(): Promise<RateLimitSnapshot> {
    return this.request("readRateLimits", [])
  }
  override fuzzyFileSearch(
    ...args: Parameters<CodexClient["fuzzyFileSearch"]>
  ): ReturnType<CodexClient["fuzzyFileSearch"]> {
    return this.request("fuzzyFileSearch", args)
  }
  override onRateLimits(listener: (limits: RateLimitSnapshot) => void): () => void {
    this.limitsListeners.add(listener)
    return () => {
      this.limitsListeners.delete(listener)
    }
  }
}
