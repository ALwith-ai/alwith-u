// The one ACP v2 client. Owns the connection, routes every update by session id,
// and publishes state through a framework-agnostic zustand store.
import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { Agent, Agents, type RuntimeClient, type SessionRunState } from "@alwith/api"
import { createStore, type StoreApi } from "zustand/vanilla"
import {
  isSelectOption,
  AgentRequests,
  createSession,
  type PendingRequest,
  SessionStore,
  type Session
} from "@alwith/api"
import type {
  AccountReadResponse,
  FuzzyFileSearchParams,
  FuzzyFileSearchResponse,
  FuzzyFileSearchSessionUpdated,
  RateLimitSnapshot,
  RateLimitsResponse,
  MarketplaceAddParams,
  MarketplaceAddResponse,
  MarketplaceUpgradeResponse,
  PluginInstalledResponse,
  PluginInstallParams,
  PluginInstallResponse,
  PluginListParams,
  PluginListResponse,
  PluginReadParams,
  PluginReadResponse,
  SkillsConfigWriteParams,
  SkillsConfigWriteResponse,
  SkillsListResponse
} from "./codex-extensions"

export type ConnectionState = "disconnected" | "connecting" | "ready" | "failed"

/** A model the gateway serves; Codex cannot list them, the client says what exists. */
export type GatewayModel = { id: string; label?: string; description?: string }

/** Fires when a session's selected model is known; `isGateway` tells whose model it is. */
export type SessionModelListener = (sessionId: string, modelId: string, isGateway: boolean) => void

export type ThreadSummary = {
  sessionId: string
  cwd: string
  title: string | null
  updatedAt: string | null
  archived: boolean
}

/** 一条等用户回答的请求,就是待办簿里的那条(`id` 是簿子的键)。 */
export type PendingAction =
  | {
      id: string
      kind: "permission"
      sessionId: string
      params: acp.RequestPermissionRequest
    }
  | {
      id: string
      kind: "elicitation"
      sessionId: string | null
      params: acp.CreateElicitationRequest
    }

function toAction(request: PendingRequest): PendingAction {
  return request.kind === "permission"
    ? { id: request.key, kind: "permission", sessionId: request.sessionId, params: request.params }
    : { id: request.key, kind: "elicitation", sessionId: request.sessionId, params: request.params }
}

/** What the Runtime starts the agent with: the engine, plus whatever the engine table takes (env, args…). */
export type Launch = { engine: string; [key: string]: unknown }

export type ClientOptions = {
  /** The one agent that hosts every session of this app. */
  agentId: string
  launch: Launch
}

export type AppState = {
  connection: ConnectionState
  connectionError: string | null
  agent: acp.InitializeResponse | null
  sessions: Record<string, Session>
  threads: ThreadSummary[]
  threadsCursor: string | null
  threadsLoaded: boolean
  threadsLoading: boolean
  threadsError: string | null
  archivedThreads: ThreadSummary[]
  archivedCursor: string | null
  archivedLoaded: boolean
  actions: PendingAction[]
  /** The Runtime's view of every session it runs: four states including `done`, keyed by session id. */
  runStates: Record<string, SessionRunState>
}

const CLIENT_INFO = { name: "alwith-u", version: "0.1.0" }
const CLIENT_CAPABILITIES = { elicitation: { form: {}, url: {} } }

function toSummary(info: acp.SessionInfo): ThreadSummary {
  const codex = info._meta?.codex
  const archived = typeof codex === "object" && codex !== null && (codex as { archived?: unknown }).archived === true
  return {
    sessionId: info.sessionId,
    cwd: info.cwd,
    title: info.title ?? null,
    updatedAt: info.updatedAt ?? null,
    archived
  }
}

/** `_meta.alwith.model`: open the thread on that gateway model (codex-acp-v2 catalog mode). */
function modelHint(model: string | null): { _meta?: { alwith: { model: string } } } {
  return model === null ? {} : { _meta: { alwith: { model } } }
}

/** The current value of the session's `model` option, if the agent exposes one. */
function selectedModel(options: acp.SessionConfigOption[]): string | null {
  const option = options.find(entry => entry.category === "model" && entry.type === "select")
  return option !== undefined && option.type === "select" && typeof option.currentValue === "string"
    ? option.currentValue
    : null
}

/** `session/resume` answered from the read path because another Codex client holds the writer. */
function isReadOnlyResume(response: acp.ResumeSessionResponse): boolean {
  const codex = (response._meta as { codex?: { readOnly?: unknown } } | undefined)?.codex
  return codex?.readOnly === true
}

export class CodexClient {
  readonly store: StoreApi<AppState>
  /**
   * Codex's dialect for the fold: `tool_call_update.content` carries the whole output every
   * time (alwith-cli sends deltas), and nothing outlives a turn or is dispatched by another
   * tool — so the other two judgments stay unset.
   */
  private readonly sessions = new SessionStore({ toolContent: "replace" })
  /** agent 发来等用户回答的请求(权限、问卷);答复、Stop 时的 cancelled、agent 的撤回都在里面。 */
  private readonly requests = new AgentRequests((id, result, error) => void this.agent?.respond(id, result, error))
  private agent: Agent | null = null
  private agents: Agents<Launch> | null = null
  private connecting: Promise<void> | null = null
  private readonly openPort: () => Promise<RuntimeClient<Launch>>
  private readonly options: ClientOptions
  private readonly skillsListeners = new Set<() => void>()
  private readonly modelListeners = new Set<SessionModelListener>()
  private readonly rateLimitListeners = new Set<(limits: RateLimitSnapshot) => void>()
  private readonly fileSearchListeners = new Set<(update: FuzzyFileSearchSessionUpdated) => void>()
  /** The adapter rejects overlapping configuration writes to one session. */
  private readonly configWrites = new Map<string, Promise<void>>()
  /** Session id → gateway model to ask for on resume; the app fills it from its preferences. */
  private readonly gatewayModels = new Map<string, string>()

  constructor(openPort: () => Promise<RuntimeClient<Launch>>, options: ClientOptions) {
    this.openPort = openPort
    this.options = options
    this.requests.onChange(pending => this.store.setState({ actions: pending.map(toAction) }))
    this.store = createStore<AppState>(() => ({
      connection: "disconnected",
      connectionError: null,
      agent: null,
      sessions: {},
      threads: [],
      threadsCursor: null,
      threadsLoaded: false,
      threadsLoading: false,
      threadsError: null,
      archivedThreads: [],
      archivedCursor: null,
      archivedLoaded: false,
      actions: [],
      runStates: {}
    }))
  }

  get state(): AppState {
    return this.store.getState()
  }

  session(id: string): Session {
    return this.sessions.get(id)
  }

  private publishSession(session: Session): void {
    this.sessions.set(session)
    this.store.setState(state => ({
      sessions: { ...state.sessions, [session.id]: session }
    }))
  }

  private live(): Agent {
    if (!this.agent || this.state.connection !== "ready") throw new Error("Codex is not connected")
    return this.agent
  }

  connect(): Promise<void> {
    if (this.state.connection === "ready") return Promise.resolve()
    if (this.connecting) return this.connecting
    this.connecting = this.doConnect().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  private async doConnect(): Promise<void> {
    this.store.setState({ connection: "connecting", connectionError: null })
    try {
      const agent = await withTimeout(this.hold(), 60_000, "Codex did not answer initialize")
      this.agent = agent
      agent.onNotification((method, params) => {
        switch (method) {
          case "session/update": {
            const update = params as { sessionId: string; update: acp.SessionUpdate }
            this.onUpdate(update.sessionId, update.update)
            break
          }
          // Codex rescanned its skills or plugins (`skills/changed`): catalogs are stale.
          case "_codex/skills_changed":
            for (const listener of this.skillsListeners) listener()
            break
          // Codex's rolling rate-limit updates (`account/rateLimits/updated`), payload verbatim.
          case "_codex/rate_limits_updated":
            for (const listener of this.rateLimitListeners) listener((params as RateLimitsResponse).rateLimits)
            break
          // Incremental results of a `fuzzyFileSearch` session; the final page arrives here too.
          case "_codex/fuzzy_file_search_updated":
            for (const listener of this.fileSearchListeners) listener(params as FuzzyFileSearchSessionUpdated)
            break
          // `$/cancel_request` (the agent withdraws a permission / form) and `elicitation/complete`
          default:
            this.requests.onNotification(method, params)
        }
      })
      agent.onAgentRequest(request => this.requests.receive(request))
      void agent.exited.then(() => this.onClosed(agent))
      this.store.setState({
        connection: "ready",
        connectionError: null,
        agent: agent.initialized as acp.InitializeResponse
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.agent = null
      this.store.setState({ connection: "failed", connectionError: message })
      throw error
    }
  }

  /**
   * One Runtime agent hosts every session. Attach to a session the Runtime still runs under our
   * agent id (reload, reconnect); otherwise start the agent. Agent requests still waiting for an
   * answer are handed over on attach and go straight into the ledger.
   */
  private async hold(): Promise<Agent> {
    const port = await this.openPort()
    port.onGap(gap => void this.reloadAfterGap(gap.sessionId))
    const agents = new Agents<Launch>(port, {
      info: CLIENT_INFO,
      capabilities: CLIENT_CAPABILITIES
    })
    this.agents = agents
    // Which sessions are ours is a read-only question (`agentForSession`); asking it by attaching
    // would claim someone else's session and, on release, leave it ownerless. Ownership is per
    // agent, so claiming one of our sessions claims the process and replays every pending request.
    for (const state of await port.runStates()) {
      if ((await port.agentForSession(state.sessionId)) !== this.options.agentId) continue
      const attached = await agents.attach(state.sessionId)
      if (!attached) continue
      this.requests.receiveAll(attached.info.pendingAgentRequests)
      return attached.agent
    }
    // A freshly started agent has no Runtime session yet. After a webview reload there is
    // therefore no session to attach through, but the process still needs to be reused.
    if ((await port.agents()).some(agent => agent.agentId === this.options.agentId)) {
      const initialized = await port.acpRequest(this.options.agentId, "initialize", {
        protocolVersion: 2,
        info: CLIENT_INFO,
        capabilities: CLIENT_CAPABILITIES
      })
      const agent = new Agent(port, this.options.agentId, this.options.launch.engine, initialized)
      await agent.listen()
      return agent
    }
    return agents.start(this.options.agentId, this.options.launch, this.options.launch.engine)
  }

  private onClosed(agent: Agent): void {
    if (this.agent !== agent) return
    this.agent = null
    // The process is gone (or we let go of it): nothing pending can be answered any more.
    this.requests.release()
    const sessions: Record<string, Session> = {}
    for (const session of this.sessions.sessions.values()) {
      const detached: Session = {
        ...session,
        attached: false,
        restoring: false,
        readOnly: false,
        state: "idle"
      }
      this.sessions.set(detached)
      sessions[session.id] = detached
    }
    this.store.setState({
      connection: "disconnected",
      connectionError: "Codex disconnected",
      sessions,
      actions: []
    })
  }

  /** Let go of the agent: the process stays in the Runtime for the next attach. */
  disconnect(): void {
    const agent = this.agent
    if (!agent) return
    this.agents?.release(agent)
    this.onClosed(agent)
  }

  /** Runtime run-state snapshot (broadcast on every change). */
  applyRunStates(sessions: SessionRunState[]): void {
    const runStates: Record<string, SessionRunState> = {}
    for (const session of sessions) runStates[session.sessionId] = session
    this.store.setState({ runStates })
  }

  private onUpdate(sessionId: string, update: acp.SessionUpdate): void {
    if (!this.sessions.sessions.has(sessionId)) this.sessions.set(createSession(sessionId, ""))
    const session = this.sessions.accept(sessionId, update)
    this.store.setState(state => ({
      sessions: { ...state.sessions, [sessionId]: session }
    }))
    if (update.sessionUpdate === "session_info_update") {
      const frame = update as acp.SessionInfoUpdate
      this.store.setState(state => ({
        threads: state.threads.map(thread =>
          thread.sessionId === sessionId
            ? {
                ...thread,
                title: frame.title === undefined ? thread.title : frame.title,
                updatedAt: frame.updatedAt === undefined ? thread.updatedAt : frame.updatedAt
              }
            : thread
        )
      }))
    }
  }

  respond(actionId: string, answer: acp.RequestPermissionResponse | acp.CreateElicitationResponse): void {
    const request = this.requests.get(actionId)
    if (!request) throw new Error("This request has expired or was already answered")
    if (request.kind === "permission") {
      const response = answer as acp.RequestPermissionResponse
      const outcome = response.outcome
      const valid =
        outcome.outcome === "cancelled" ||
        (outcome.outcome === "selected" &&
          request.params.options.some(option => option.optionId === (outcome as { optionId: string }).optionId))
      if (!valid) throw new Error("Invalid permission choice")
    } else {
      const response = answer as acp.CreateElicitationResponse
      if (!["accept", "decline", "cancel"].includes(response.action)) throw new Error("Invalid form action")
    }
    this.requests.answer(actionId, answer)
  }

  async listThreads(options: { reset?: boolean; archived?: boolean } = {}): Promise<void> {
    const archived = options.archived === true
    const state = this.state
    const cursor = options.reset ? null : archived ? state.archivedCursor : state.threadsCursor
    if (!options.reset && (archived ? state.archivedLoaded : state.threadsLoaded) && cursor === null) return
    if (!archived) this.store.setState({ threadsLoading: true, threadsError: null })
    const request: acp.ListSessionsRequest = {
      ...(cursor ? { cursor } : {}),
      ...(archived ? { _meta: { codex: { archived: true } } } : {})
    }
    try {
      const response = await this.live().request<acp.ListSessionsResponse>("session/list", request)
      const page = response.sessions.map(toSummary)
      const nextCursor = response.nextCursor ?? null
      this.store.setState(current => {
        const previous = options.reset ? [] : archived ? current.archivedThreads : current.threads
        const merged = [...previous.filter(thread => !page.some(item => item.sessionId === thread.sessionId)), ...page]
        return archived
          ? {
              archivedThreads: merged,
              archivedCursor: nextCursor,
              archivedLoaded: true
            }
          : { threads: merged, threadsCursor: nextCursor, threadsLoaded: true }
      })
    } catch (error) {
      if (!archived) this.store.setState({ threadsError: error instanceof Error ? error.message : String(error) })
      throw error
    } finally {
      if (!archived) this.store.setState({ threadsLoading: false })
    }
  }

  /** Read a complete project index without changing the sidebar's pagination or persisting history. */
  async listProjectThreads(cwd: string): Promise<ThreadSummary[]> {
    const agent = this.live()
    const threads = new Map<string, ThreadSummary>()
    const cursors = new Set<string>()
    let cursor: string | undefined
    do {
      const response = await agent.request<acp.ListSessionsResponse>("session/list", {
        cwd,
        ...(cursor === undefined ? {} : { cursor })
      })
      for (const info of response.sessions) {
        const thread = toSummary(info)
        if (thread.cwd === cwd && !thread.archived) threads.set(thread.sessionId, thread)
      }
      cursor = response.nextCursor ?? undefined
      if (cursor !== undefined) {
        if (cursors.has(cursor)) throw new Error("Session list returned a repeated cursor")
        cursors.add(cursor)
      }
    } while (cursor !== undefined)
    return [...threads.values()]
  }

  async newSession(cwd: string, model: string | null = null): Promise<string> {
    const response = await this.live().request<acp.NewSessionResponse>("session/new", {
      cwd,
      mcpServers: [],
      ...modelHint(model)
    })
    const existing = this.sessions.sessions.get(response.sessionId)
    const session: Session = {
      ...(existing ?? createSession(response.sessionId, cwd)),
      cwd,
      attached: true,
      restoring: false,
      configOptions: response.configOptions ?? [],
      error: null
    }
    this.publishSession(session)
    this.noteModel(session)
    this.store.setState(state => ({
      threads: [
        {
          sessionId: session.id,
          cwd,
          title: null,
          updatedAt: new Date().toISOString(),
          archived: false
        },
        ...state.threads.filter(thread => thread.sessionId !== session.id)
      ]
    }))
    return session.id
  }

  async open(id: string, cwd: string): Promise<void> {
    const existing = this.sessions.sessions.get(id)
    if (existing?.attached || existing?.restoring) return
    await this.replay(id, cwd)
  }

  /**
   * The client could not refill a hole in this session's event stream (the Runtime journal had
   * already dropped those frames): what we hold is no longer continuous, so replay the whole
   * session from the engine's own record instead of rendering as if nothing happened.
   */
  private async reloadAfterGap(id: string): Promise<void> {
    const session = this.sessions.sessions.get(id)
    if (!session || session.restoring) return
    await this.replay(id, session.cwd)
  }

  private async replay(id: string, cwd: string): Promise<void> {
    if (!this.sessions.sessions.has(id)) this.sessions.set(createSession(id, cwd))
    this.sessions.beginReplay(id)
    this.publishSession(this.sessions.get(id))
    try {
      const response = await this.live().request<acp.ResumeSessionResponse>("session/resume", {
        sessionId: id,
        cwd,
        replayFrom: { type: "start" },
        ...modelHint(this.gatewayModels.get(id) ?? null)
      })
      this.publishSession({
        ...this.sessions.get(id),
        cwd,
        attached: true,
        restoring: false,
        readOnly: isReadOnlyResume(response),
        configOptions: response.configOptions ?? [],
        error: null
      })
      this.noteModel(this.sessions.get(id))
    } catch (error) {
      this.publishSession({
        ...this.sessions.get(id),
        restoring: false,
        attached: false
      })
      throw error
    }
  }

  async prompt(id: string, prompt: acp.ContentBlock[]): Promise<void> {
    const session = this.sessions.get(id)
    if (!session.attached) throw new Error("Open the chat before sending")
    if (prompt.length === 0) throw new Error("Enter a message")
    // The user's message goes on screen now. Codex reports it back as a `user_message`
    // once the turn starts and the fold adopts that id; an agent that never reports
    // (alwith-cli) leaves the local copy as is.
    this.sessions.addPrompt(id, prompt)
    this.publishSession(this.sessions.get(id))
    await this.live().request("session/prompt", { sessionId: id, prompt })
  }

  async cancel(id: string): Promise<void> {
    // The protocol: every pending permission of the session MUST be answered `cancelled`
    // (and forms cancelled) — otherwise they hang in the agent and the Runtime and come back
    // as zombie prompts on the next attach.
    this.requests.cancelSession(id)
    await this.live().notify("session/cancel", { sessionId: id })
  }

  async setConfig(id: string, configId: string, value: string | boolean): Promise<void> {
    const write = async (): Promise<void> => {
      const response = await this.live().request<acp.SetSessionConfigOptionResponse>(
        "session/set_config_option",
        typeof value === "boolean"
          ? { sessionId: id, configId, type: "boolean", value }
          : { sessionId: id, configId, type: "id", value }
      )
      this.publishSession({
        ...this.sessions.get(id),
        configOptions: response.configOptions
      })
      this.noteModel(this.sessions.get(id))
    }
    const previous = this.configWrites.get(id)
    const pending = previous ? previous.catch(() => {}).then(write) : write()
    this.configWrites.set(id, pending)
    void pending.then(
      () => {
        if (this.configWrites.get(id) === pending) this.configWrites.delete(id)
      },
      () => {
        if (this.configWrites.get(id) === pending) this.configWrites.delete(id)
      }
    )
    return pending
  }

  /** Whether the agent can host gateway models in the per-session model option. */
  get providerCatalog(): boolean {
    const codex = this.state.agent?.capabilities?._meta?.codex
    return (
      typeof codex === "object" && codex !== null && (codex as { providerCatalog?: unknown }).providerCatalog === true
    )
  }

  /** Seeds the resume hints for threads the user moved to the gateway. */
  setGatewayModels(models: Record<string, string>): void {
    this.gatewayModels.clear()
    for (const [sessionId, model] of Object.entries(models)) this.gatewayModels.set(sessionId, model)
  }

  onSessionModel(listener: SessionModelListener): () => void {
    this.modelListeners.add(listener)
    return () => this.modelListeners.delete(listener)
  }

  /** Reads the session's selected model and tells listeners whether it is a gateway model. */
  private noteModel(session: Session): void {
    const modelId = selectedModel(session.configOptions)
    if (modelId === null) return
    const option = session.configOptions.find(entry => entry.category === "model" && entry.type === "select")
    const isGateway =
      option !== undefined &&
      isSelectOption(option) &&
      option.options.some(
        group => "groupId" in group && group.groupId !== "codex" && group.options.some(model => model.value === modelId)
      )
    if (isGateway) this.gatewayModels.set(session.id, modelId)
    else this.gatewayModels.delete(session.id)
    for (const listener of this.modelListeners) listener(session.id, modelId, isGateway)
  }

  async login(methodId: string, extra: Record<string, unknown> = {}): Promise<void> {
    await this.live().request("auth/login", {
      methodId,
      ...(Object.keys(extra).length ? { _meta: extra } : {})
    })
  }

  async logout(): Promise<void> {
    await this.live().request("auth/logout", {})
  }

  async close(id: string): Promise<void> {
    await this.live().request("session/close", { sessionId: id })
    this.dropSession(id)
  }

  async archive(id: string): Promise<void> {
    await this.live().request("_codex/session_archive", { sessionId: id })
    this.dropSession(id)
    this.store.setState(state => {
      const thread = state.threads.find(item => item.sessionId === id)
      return {
        threads: state.threads.filter(item => item.sessionId !== id),
        archivedThreads: thread
          ? [{ ...thread, archived: true }, ...state.archivedThreads.filter(item => item.sessionId !== id)]
          : state.archivedThreads
      }
    })
  }

  async unarchive(id: string): Promise<void> {
    await this.live().request("_codex/session_unarchive", { sessionId: id })
    this.store.setState(state => {
      const thread = state.archivedThreads.find(item => item.sessionId === id)
      return {
        archivedThreads: state.archivedThreads.filter(item => item.sessionId !== id),
        threads: thread ? [{ ...thread, archived: false }, ...state.threads] : state.threads
      }
    })
  }

  async delete(id: string): Promise<void> {
    await this.live().request("session/delete", { sessionId: id })
    this.dropSession(id)
    this.store.setState(state => ({
      threads: state.threads.filter(item => item.sessionId !== id),
      archivedThreads: state.archivedThreads.filter(item => item.sessionId !== id)
    }))
  }

  async fork(id: string, cwd: string): Promise<string> {
    const response = await this.live().request<acp.ForkSessionResponse>("session/fork", {
      sessionId: id,
      cwd,
      ...modelHint(this.gatewayModels.get(id) ?? null)
    })
    const forked = this.sessions.sessions.get(response.sessionId) ?? createSession(response.sessionId, cwd)
    this.publishSession({
      ...forked,
      cwd,
      attached: true,
      restoring: false,
      configOptions: response.configOptions ?? []
    })
    this.noteModel(this.sessions.get(response.sessionId))
    this.store.setState(state => ({
      threads: [
        {
          sessionId: response.sessionId,
          cwd,
          title: null,
          updatedAt: new Date().toISOString(),
          archived: false
        },
        ...state.threads
      ]
    }))
    return response.sessionId
  }

  // ── Rename, account, rate limits, file search (codex-acp-v2 `_codex/*` extensions) ──

  /** Codex `thread/name/set`; the list is patched at once, the `session_info_update` confirms it. */
  async renameSession(id: string, name: string): Promise<void> {
    await this.live().request("_codex/session_rename", { sessionId: id, name })
    const rename = (thread: ThreadSummary) => (thread.sessionId === id ? { ...thread, title: name } : thread)
    this.store.setState(state => ({
      threads: state.threads.map(rename),
      archivedThreads: state.archivedThreads.map(rename)
    }))
    const session = this.sessions.sessions.get(id)
    if (session) this.publishSession({ ...session, title: name })
  }

  readAccount(): Promise<AccountReadResponse> {
    return this.live().request<AccountReadResponse>("_codex/account_read", {})
  }

  async readRateLimits(): Promise<RateLimitSnapshot> {
    const response = await this.live().request<RateLimitsResponse>("_codex/rate_limits", {})
    return response.rateLimits
  }

  /** Fires on every `_codex/rate_limits_updated`; returns the unsubscribe. */
  onRateLimits(listener: (limits: RateLimitSnapshot) => void): () => void {
    this.rateLimitListeners.add(listener)
    return () => this.rateLimitListeners.delete(listener)
  }

  /** Codex's own file search (`fuzzyFileSearch`), the one the official app's `@` uses. */
  fuzzyFileSearch(params: FuzzyFileSearchParams): Promise<FuzzyFileSearchResponse> {
    return this.live().request<FuzzyFileSearchResponse>("_codex/fuzzy_file_search", params)
  }

  onFileSearchUpdate(listener: (update: FuzzyFileSearchSessionUpdated) => void): () => void {
    this.fileSearchListeners.add(listener)
    return () => this.fileSearchListeners.delete(listener)
  }

  // ── Skills and plugin marketplaces (codex-acp-v2 `_codex/*` extensions) ──

  /** Fires after `_codex/skills_changed`; returns the unsubscribe. */
  onSkillsChanged(listener: () => void): () => void {
    this.skillsListeners.add(listener)
    return () => this.skillsListeners.delete(listener)
  }

  listSkills(cwds?: string[], forceReload = false): Promise<SkillsListResponse> {
    return this.live().request<SkillsListResponse>("_codex/skills_list", {
      ...(cwds && cwds.length > 0 ? { cwds } : {}),
      ...(forceReload ? { forceReload } : {})
    })
  }

  setSkillEnabled(params: SkillsConfigWriteParams): Promise<SkillsConfigWriteResponse> {
    return this.live().request<SkillsConfigWriteResponse>("_codex/skills_config_write", params)
  }

  listPlugins(params: PluginListParams = {}): Promise<PluginListResponse> {
    return this.live().request<PluginListResponse>("_codex/plugin_list", params)
  }

  installedPlugins(cwds?: string[]): Promise<PluginInstalledResponse> {
    return this.live().request<PluginInstalledResponse>(
      "_codex/plugin_installed",
      cwds && cwds.length > 0 ? { cwds } : {}
    )
  }

  installPlugin(params: PluginInstallParams): Promise<PluginInstallResponse> {
    return this.live().request<PluginInstallResponse>("_codex/plugin_install", params)
  }

  async uninstallPlugin(pluginId: string): Promise<void> {
    await this.live().request("_codex/plugin_uninstall", { pluginId })
  }

  readPlugin(params: PluginReadParams): Promise<PluginReadResponse> {
    return this.live().request<PluginReadResponse>("_codex/plugin_read", params)
  }

  addMarketplace(params: MarketplaceAddParams): Promise<MarketplaceAddResponse> {
    return this.live().request<MarketplaceAddResponse>("_codex/marketplace_add", params)
  }

  async removeMarketplace(marketplaceName: string): Promise<void> {
    await this.live().request("_codex/marketplace_remove", { marketplaceName })
  }

  upgradeMarketplaces(marketplaceName?: string): Promise<MarketplaceUpgradeResponse> {
    return this.live().request<MarketplaceUpgradeResponse>(
      "_codex/marketplace_upgrade",
      marketplaceName ? { marketplaceName } : {}
    )
  }

  private dropSession(id: string): void {
    this.requests.cancelSession(id)
    this.sessions.sessions.delete(id)
    this.store.setState(state => {
      const { [id]: _removed, ...sessions } = state.sessions
      return { sessions }
    })
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
