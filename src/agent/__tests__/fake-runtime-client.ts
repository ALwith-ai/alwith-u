// An in-memory RuntimeClient: `start` wires an AgentApp to the port over ndJSON streams, so the
// Runtime transport is exercised end to end without a process or a socket.
import * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { RuntimeRequestError } from "@alwith/api"
import type {
  RuntimeGap,
  RuntimeAcpAgentRequest,
  RuntimeAcpNotification,
  RuntimeAttachInfo,
  RuntimeClient,
  RuntimeExitPayload,
  RuntimeInboundPayload,
  RuntimePendingAgentRequest,
  RuntimePromptResult,
  RuntimeResponseError,
  RuntimeSessionResult,
  SessionRunState
} from "@alwith/api"

type Agent = {
  writer: WritableStreamDefaultWriter<Uint8Array>
  connection: acp.AgentConnection
}

export class FakeHubPort implements RuntimeClient<{ engine: string }> {
  readonly started: string[] = []
  readonly attached: string[] = []
  readonly marked: string[] = []
  private readonly processes = new Map<string, Agent>()
  private readonly lineHandlers = new Set<(payload: RuntimeInboundPayload) => void>()
  private readonly exitHandlers = new Set<(payload: RuntimeExitPayload) => void>()
  private readonly runStateHandlers = new Set<(sessions: SessionRunState[]) => void>()
  private readonly acpNotificationHandlers = new Set<(notification: RuntimeAcpNotification) => void>()
  private readonly acpAgentRequestHandlers = new Set<(request: RuntimeAcpAgentRequest) => void>()
  /** Requests this fake Runtime issued itself (`rt-<n>`), like the real one. */
  private readonly pendingAcp = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private nextAcpId = 1
  private states: SessionRunState[] = []
  private pending: Record<string, RuntimeAttachInfo> = {}
  /** What the real Runtime replays for a repeated `initialize`: the agent's original initialize result. */
  private initializeSnapshot: unknown = null
  private initializeRequestId: unknown = null

  private readonly agentFactory: () => acp.AgentApp

  constructor(agentFactory: () => acp.AgentApp) {
    this.agentFactory = agentFactory
  }

  /** Simulates a Runtime that already runs a session for `agentId` and holds unanswered agent requests. */
  seedRunningSession(sessionId: string, agentId: string, pendingAgentRequests: RuntimePendingAgentRequest[]): void {
    this.initializeSnapshot = {
      protocolVersion: 2,
      info: { name: "fake-codex", version: "1" },
      capabilities: {},
      authMethods: []
    }
    this.states.push({
      sessionId,
      state: "requires_action",
      reusableDraft: false,
      owner: "",
      cwd: "/tmp",
      title: "",
      since: 0,
      tasks: [],
      listeningPorts: [],
      executionId: null,
      executionRole: null,
      lastActivityAt: 0
    })
    this.pending[sessionId] = { agentId, engine: "fake", provider: "", pendingAgentRequests }
  }

  async start(agentId: string, _launch: { engine: string }): Promise<void> {
    this.started.push(agentId)
    const decoder = new TextDecoder()
    const toAgent = new TransformStream<Uint8Array, Uint8Array>()
    let buffered = ""
    const fromAgent = new WritableStream<Uint8Array>({
      write: chunk => {
        buffered += decoder.decode(chunk, { stream: true })
        const lines = buffered.split("\n")
        buffered = lines.pop() ?? ""
        const inbound: string[] = []
        for (const line of lines.filter(line => line.length > 0)) {
          const value = JSON.parse(line) as {
            id?: unknown
            result?: unknown
            error?: unknown
            method?: string
            params?: unknown
          }
          if (value.method === undefined && value.id === this.initializeRequestId && value.result !== undefined) {
            this.initializeSnapshot = value.result
          }
          // Like the real Runtime: answers to its own requests never reach `inbound`; notifications and
          // agent requests are split out as events alongside the raw line.
          const waiter =
            value.method === undefined && typeof value.id === "string" ? this.pendingAcp.get(value.id) : undefined
          if (waiter !== undefined) {
            this.pendingAcp.delete(value.id as string)
            if (value.error !== undefined && value.error !== null)
              waiter.reject(new RuntimeRequestError("acpRequest", value.error as RuntimeResponseError))
            else waiter.resolve(value.result ?? null)
            continue
          }
          if (value.method !== undefined) {
            if (value.id !== undefined && value.id !== null) {
              for (const handler of this.acpAgentRequestHandlers)
                handler({ agentId, id: value.id, method: value.method, params: value.params })
            } else {
              for (const handler of this.acpNotificationHandlers)
                handler({ agentId, method: value.method, params: value.params })
            }
          }
          inbound.push(line)
        }
        if (inbound.length > 0) for (const handler of this.lineHandlers) handler({ agentId, lines: inbound })
      }
    })
    const connection = this.agentFactory().connect(acp.ndJsonStream(fromAgent, toAgent.readable))
    this.processes.set(agentId, { writer: toAgent.writable.getWriter(), connection })
  }

  async send(agentId: string, line: string): Promise<void> {
    const agent = this.processes.get(agentId)
    if (!agent) throw new Error(`no agent process ${agentId}`)
    const value = JSON.parse(line) as { id?: unknown; method?: unknown }
    // Like RuntimeRuntime: a repeated initialize is answered from the cache, never forwarded.
    if (value.method === "initialize") {
      if (this.initializeSnapshot !== null) {
        const reply = JSON.stringify({ jsonrpc: "2.0", id: value.id, result: this.initializeSnapshot })
        for (const handler of this.lineHandlers) handler({ agentId, lines: [reply] })
        return
      }
      this.initializeRequestId = value.id
    }
    await agent.writer.write(new TextEncoder().encode(`${line}\n`))
  }

  async stop(agentId: string): Promise<void> {
    const agent = this.processes.get(agentId)
    if (!agent) return
    this.processes.delete(agentId)
    agent.connection.close()
    for (const handler of this.exitHandlers) handler({ agentId })
  }

  async attachSession(sessionId: string): Promise<RuntimeAttachInfo | null> {
    this.attached.push(sessionId)
    return this.pending[sessionId] ?? null
  }

  async agentForSession(sessionId: string): Promise<string | null> {
    return this.pending[sessionId]?.agentId ?? null
  }

  async releaseSession(): Promise<void> {}
  async stopSession(): Promise<void> {}
  async markRead(sessionId: string): Promise<void> {
    this.marked.push(sessionId)
  }
  async setSessionTitle(): Promise<void> {}
  async sessionLifecycle() {
    return []
  }
  async sessionEvents() {
    return []
  }
  async runStates(): Promise<SessionRunState[]> {
    return this.states
  }
  async version(): Promise<string> {
    return "fake"
  }

  // ---- the ACP layer, mirroring the real Runtime ----

  async acpRequest<Result = unknown>(agentId: string, method: string, params?: unknown): Promise<Result> {
    if (method === "initialize" && this.initializeSnapshot !== null) return this.initializeSnapshot as Result
    const id = `rt-${this.nextAcpId++}`
    const answer = new Promise<unknown>((resolve, reject) => this.pendingAcp.set(id, { resolve, reject }))
    await this.send(agentId, JSON.stringify({ jsonrpc: "2.0", id, method, params }))
    return (await answer) as Result
  }

  async acpNotify(agentId: string, method: string, params?: unknown): Promise<void> {
    await this.send(agentId, JSON.stringify({ jsonrpc: "2.0", method, params }))
  }

  async acpRespond(agentId: string, id: unknown, result?: unknown, error?: unknown): Promise<void> {
    const frame = error === undefined ? { jsonrpc: "2.0", id, result: result ?? null } : { jsonrpc: "2.0", id, error }
    await this.send(agentId, JSON.stringify(frame))
  }

  initialize(
    agentId: string,
    info?: { name: string; version: string },
    capabilities?: Record<string, unknown>
  ): Promise<unknown> {
    return this.acpRequest(agentId, "initialize", {
      protocolVersion: 2,
      info: info ?? { name: "fake-runtime", version: "0" },
      capabilities: capabilities ?? {}
    })
  }

  private async ensureInitialized(agentId: string): Promise<void> {
    await this.initialize(agentId)
  }

  private withMeta(params: Record<string, unknown>, meta?: Record<string, unknown>): Record<string, unknown> {
    return meta === undefined ? params : { ...params, _meta: meta }
  }

  async sessionNew(
    agentId: string,
    cwd: string,
    mcpServers: unknown[] = [],
    meta?: Record<string, unknown>
  ): Promise<RuntimeSessionResult> {
    await this.ensureInitialized(agentId)
    return this.acpRequest(agentId, "session/new", this.withMeta({ cwd, mcpServers }, meta))
  }

  async sessionLoad(
    agentId: string,
    sessionId: string,
    cwd: string,
    mcpServers: unknown[] = [],
    meta?: Record<string, unknown>
  ): Promise<RuntimeSessionResult> {
    await this.ensureInitialized(agentId)
    return this.acpRequest(agentId, "session/load", this.withMeta({ sessionId, cwd, mcpServers }, meta))
  }

  async sessionResume(
    agentId: string,
    sessionId: string,
    cwd: string,
    replayFrom?: unknown,
    meta?: Record<string, unknown>
  ): Promise<RuntimeSessionResult> {
    await this.ensureInitialized(agentId)
    return this.acpRequest(
      agentId,
      "session/resume",
      this.withMeta(replayFrom === undefined ? { sessionId, cwd } : { sessionId, cwd, replayFrom }, meta)
    )
  }

  async sessionFork(
    agentId: string,
    sessionId: string,
    cwd: string,
    mcpServers: unknown[] = [],
    meta?: Record<string, unknown>
  ): Promise<RuntimeSessionResult> {
    await this.ensureInitialized(agentId)
    return this.acpRequest(agentId, "session/fork", this.withMeta({ sessionId, cwd, mcpServers }, meta))
  }

  prompt(
    agentId: string,
    sessionId: string,
    prompt: unknown[],
    meta?: Record<string, unknown>
  ): Promise<RuntimePromptResult> {
    return this.acpRequest(agentId, "session/prompt", this.withMeta({ sessionId, prompt }, meta))
  }

  cancel(agentId: string, sessionId: string): Promise<void> {
    return this.acpNotify(agentId, "session/cancel", { sessionId })
  }

  async onAcpNotification(handler: (notification: RuntimeAcpNotification) => void): Promise<() => void> {
    this.acpNotificationHandlers.add(handler)
    return () => this.acpNotificationHandlers.delete(handler)
  }

  async onAcpAgentRequest(handler: (request: RuntimeAcpAgentRequest) => void): Promise<() => void> {
    this.acpAgentRequestHandlers.add(handler)
    return () => this.acpAgentRequestHandlers.delete(handler)
  }
  async agents() {
    return [...this.processes.keys()].map(agentId => ({
      agentId,
      pid: null,
      provider: "",
      model: "",
      connection: "",
      cpu: 0,
      memMb: 0,
      uptimeSecs: 0
    }))
  }
  async ping(): Promise<void> {}
  async onInbound(handler: (payload: RuntimeInboundPayload) => void): Promise<() => void> {
    this.lineHandlers.add(handler)
    return () => this.lineHandlers.delete(handler)
  }
  async onExit(handler: (payload: RuntimeExitPayload) => void): Promise<() => void> {
    this.exitHandlers.add(handler)
    return () => this.exitHandlers.delete(handler)
  }
  async onStderr(): Promise<() => void> {
    return () => {}
  }
  async onRunStates(handler: (sessions: SessionRunState[]) => void): Promise<() => void> {
    this.runStateHandlers.add(handler)
    return () => this.runStateHandlers.delete(handler)
  }

  async onOutbound(): Promise<() => void> {
    return () => undefined
  }

  readonly gapHandlers = new Set<(gap: RuntimeGap) => void>()
  onGap(handler: (gap: RuntimeGap) => void): () => void {
    this.gapHandlers.add(handler)
    return () => this.gapHandlers.delete(handler)
  }
}
