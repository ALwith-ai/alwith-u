// Only main owns the ACP connection. The chat window receives projections and forwards
// a fixed set of actions; it never attaches an agent or persists another conversation.
import { emitTo, listen } from "@tauri-apps/api/event"
import { CodexClient, type AppState } from "@/agent/client"
import type { RateLimitSnapshot } from "@/agent/codex-extensions"
import type { Session } from "@alwith/api"

export type ChatEvents = { listen: typeof listen; emitTo: typeof emitTo }
const events: ChatEvents = { listen, emitTo }
const REQUEST = "chat:client-request"
const RESPONSE = "chat:client-response"
const STATE = "chat:client-state"
const LIMITS = "chat:client-limits"
const CLOSED = "chat:client-closed"
const METHODS = [
  "connect",
  "newSession",
  "open",
  "prompt",
  "cancel",
  "setConfig",
  "respond",
  "readRateLimits",
  "fuzzyFileSearch"
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
  let connectionId: string | null = null
  let disposed = false
  let revision = 0
  let previous: AppState | null = null
  let publishing = Promise.resolve()
  const publish = (): Promise<void> => {
    if (disposed || connectionId === null) return Promise.resolve()
    const identity = connectionId
    const state = owner.state
    const next = publishing.then(async () => {
      if (disposed || identity !== connectionId) return
      const patch: Partial<AppState> = {}
      for (const key of Object.keys(state) as (keyof AppState)[]) {
        if (key !== "sessions" && (previous === null || state[key] !== previous[key]))
          Object.assign(patch, { [key]: state[key] })
      }
      const sessions = Object.fromEntries(
        Object.entries(state.sessions).filter(([id, session]) => previous === null || previous.sessions[id] !== session)
      )
      if (Object.keys(sessions).length > 0) patch.sessions = sessions
      const removedSessions =
        previous === null ? [] : Object.keys(previous.sessions).filter(id => !(id in state.sessions))
      const payload: Projection = {
        connectionId: identity,
        revision: ++revision,
        patch,
        reset: previous === null,
        removedSessions
      }
      await transport.emitTo("chat", STATE, payload)
      previous = state
    })
    // A failed delivery must not poison future updates. The next update sends a full snapshot.
    publishing = next.catch(() => {
      previous = null
    })
    return next
  }

  const stop = await transport.listen<Request>(REQUEST, async ({ payload: request }) => {
    if (disposed) return
    try {
      if (!METHODS.includes(request.method) || !Array.isArray(request.args)) throw new Error("Invalid chat action")
      if (request.method === "connect") {
        connectionId = request.connectionId
        previous = null
      } else if (request.connectionId !== connectionId) throw new Error("Chat window connection expired")
      const action = owner[request.method] as (...args: unknown[]) => unknown
      const result = await action.apply(owner, request.args)
      if (disposed || connectionId !== request.connectionId) return
      await publish()
      await transport.emitTo("chat", RESPONSE, { connectionId, id: request.id, result } satisfies Response)
    } catch (error) {
      if (disposed) return
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
  })
  const stopState = owner.store.subscribe(() => {
    void publish().catch(onError)
  })
  const stopLimits = owner.onRateLimits(limits => {
    if (connectionId !== null) void transport.emitTo("chat", LIMITS, { connectionId, limits })
  })
  return () => {
    disposed = true
    stop()
    stopState()
    stopLimits()
    void transport.emitTo("chat", CLOSED, { connectionId })
  }
}

export class RemoteChatClient extends CodexClient {
  private readonly transport: ChatEvents
  private connectionId = crypto.randomUUID()
  private ready: Promise<void> | null = null
  private stopListeners: (() => void)[] = []
  private revision = 0
  private readonly limitsListeners = new Set<(limits: RateLimitSnapshot) => void>()
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >()

  constructor(transport: ChatEvents = events) {
    super(
      async () => {
        throw new Error("Chat window cannot own an agent connection")
      },
      { agentId: "codex", launch: { engine: "codex" } }
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
      this.transport.listen<Projection>(STATE, ({ payload }) => {
        if (payload.connectionId !== this.connectionId || payload.revision <= this.revision) return
        this.revision = payload.revision
        this.store.setState(state => {
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
      this.pending.set(id, { resolve: value => resolve(value as Awaited<ReturnType<CodexClient[M]>>), reject, timer })
      void this.transport
        .emitTo("main", REQUEST, { connectionId: this.connectionId, id, method, args } satisfies Request)
        .catch((error: unknown) => {
          clearTimeout(timer)
          this.pending.delete(id)
          reject(error)
        })
    })
  }

  override disconnect(): void {
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
      actions: [],
      runStates: {},
      threads: []
    })
  }

  override session(id: string): Session {
    const session = this.state.sessions[id]
    if (!session) throw new Error(`Unknown session: ${id}`)
    return session
  }
  override newSession(...args: Parameters<CodexClient["newSession"]>): Promise<string> {
    return this.request("newSession", args)
  }
  override open(...args: Parameters<CodexClient["open"]>): Promise<void> {
    return this.request("open", args)
  }
  override prompt(...args: Parameters<CodexClient["prompt"]>): Promise<void> {
    return this.request("prompt", args)
  }
  override cancel(...args: Parameters<CodexClient["cancel"]>): Promise<void> {
    return this.request("cancel", args)
  }
  override setConfig(...args: Parameters<CodexClient["setConfig"]>): Promise<void> {
    return this.request("setConfig", args)
  }
  override respond(...args: Parameters<CodexClient["respond"]>): void {
    // Existing approval UI uses synchronous respond; surface asynchronous failures globally.
    void this.request("respond", args)
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
