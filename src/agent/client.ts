// U's Codex client: `@nyssance/codex-acp-v2/client`'s CodexClient (which is `@alwith/api/client`'s
// SessionClient plus the adapter's `_codex/*` extensions) with what only this product does: two chat
// slots (main window and floating chat) that each hold a draft and remember a model, gateway model
// hints, project grouping of the list, and fork titles.
//
// 2026-10-27 chat-layer extraction: the engine-neutral orchestration moved to `@alwith/api/client`,
// the Codex extensions (history, skills, plugins, rate limits, file search, lineage) to the adapter.
import { isBooleanOption, isGroupedSelect, isSelectOption, type RuntimeClient, type Session } from "@alwith/api"
import {
  type ClientOptions as BaseClientOptions,
  mergeMeta,
  type NewSessionOptions,
  type PendingAction,
  type SessionOperation,
  type SessionRequestOptions,
  type SessionSummary,
  type StateSetter
} from "@alwith/api/client"
import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import {
  CodexClient as CodexAcpClient,
  type CodexClientState,
  type ForkOptions,
  type ForkOrigin
} from "@nyssance/codex-acp-v2/client"

import { forkTitle } from "./fork-title"

export type { ForkOrigin, PendingAction }

/**
 * Model group of the ChatGPT models the codex adapter serves next to gateway groups. Named after the
 * models, not the CLI that serves them (codex-acp-v2 0.7.3 and later).
 */
export const NATIVE_MODEL_GROUP = { id: "chatgpt", name: "ChatGPT" } as const

/** A model the gateway serves; Codex cannot list them, the client says what exists. */
export type GatewayModel = { id: string; label?: string; description?: string }

/** Fires when a session's selected model is known; `isGateway` tells whose model it is. */
export type SessionModelListener = (sessionId: string, modelId: string, isGateway: boolean) => void

export type { SessionSummary } from "@alwith/api/client"

/** What the Runtime starts the agent with: the engine, plus whatever the engine table takes (env, args…). */
export type Launch = { engine: string; [key: string]: unknown }

export type ClientOptions = BaseClientOptions & {
  /** Resolve a slot selection against the host's applied provider configuration. */
  resolveModel?: (model: string | null) => Promise<string | null>
}

export type DraftOwner = "main" | "chat"

export type AppState = CodexClientState & {
  /** Window ownership survives switching the visible conversation; never persisted. */
  sessionWindows: Record<string, DraftOwner>
  /** Only drafts created by this connection are eligible for automatic cleanup. */
  draftSessions: Record<string, DraftOwner>
}

/** `_meta.alwith.model`: open the thread on that gateway model (codex-acp-v2 catalog mode). */
function modelHint(model: string | null): Record<string, unknown> | undefined {
  return model === null ? undefined : { alwith: { model } }
}

/** The current value of the session's `model` option, if the agent exposes one. */
function selectedModel(options: acp.SessionConfigOption[]): string | null {
  const option = options.find((entry) => entry.category === "model" && entry.type === "select")
  return option?.type === "select" && typeof option.currentValue === "string" ? option.currentValue : null
}

export class CodexClient extends CodexAcpClient<AppState> {
  private readonly modelListeners = new Set<SessionModelListener>()
  private readonly confirmedModelListeners = new Set<(owner: DraftOwner, model: string) => void>()
  private savedModels: Record<DraftOwner, string | null> = { main: null, chat: null }
  private slotModels: Record<DraftOwner, string | null> = { main: null, chat: null }
  private slotTargets: Record<DraftOwner, string | null> = { main: null, chat: null }
  private slotVersions: Record<DraftOwner, number> = { main: 0, chat: 0 }
  private readonly draftOperations = new Map<DraftOwner, Promise<unknown>>()
  /** Attached session selections, retained for forks and event-stream repair only. */
  private readonly gatewayModels = new Map<string, string>()
  /** Which slot asked for a configuration write, so a confirmed model lands in that slot's memory. */
  private readonly configOwners = new Map<string, DraftOwner>()
  /** Which slot is opening a session, so its replay resolves that slot's model once the replay has started. */
  private readonly openingOwners = new Map<string, DraftOwner>()
  private readonly resolveModelOption: ClientOptions["resolveModel"]

  constructor(openPort: () => Promise<RuntimeClient<Launch>>, options: ClientOptions) {
    const { resolveModel, ...base } = options
    super(openPort, { info: { name: "alwith-u", version: "0.1.0" }, ...base }, { sessionWindows: {}, draftSessions: {} })
    this.resolveModelOption = resolveModel
  }

  private setApp(partial: StateSetter<AppState>): void {
    this.store.setState(partial)
  }

  // ── List by project ──

  /** Project views share the complete in-memory list with the sidebar. */
  async listProjectSessions(cwd: string): Promise<SessionSummary[]> {
    await this.listSessions()
    const project = this.projectPath(cwd)
    return this.state.sessionList.filter((item) => item.cwd === project)
  }

  // ── Slots: create, open, configure ──

  /** `newSession(cwd, model, owner)` creates a listed chat in a slot; the options form is the base client's. */
  override async newSession(
    cwd: string,
    model: string | null | NewSessionOptions = null,
    owner: DraftOwner = "main"
  ): Promise<string> {
    if (model !== null && typeof model === "object") return super.newSession(cwd, model)
    const version = ++this.slotVersions[owner]
    const id = await this.createNativeSession(cwd, model, null)
    this.activateSlot(owner, id, version)
    return id
  }

  private async createNativeSession(cwd: string, model: string | null, owner: DraftOwner | null): Promise<string> {
    const id = await super.newSession(cwd, {
      draft: owner !== null,
      meta: mergeMeta(modelHint(model), owner === null ? undefined : { alwith: { draft: true } })
    })
    if (owner !== null) this.setApp((state) => ({ draftSessions: { ...state.draftSessions, [id]: owner } }))
    this.noteModel(this.session(id))
    return id
  }

  /** `open(id, cwd, owner)` shows a session in a slot; the options form is the base client's. */
  override async open(id: string, cwd: string, owner: DraftOwner | SessionRequestOptions = "main"): Promise<void> {
    if (typeof owner !== "string") return super.open(id, cwd, owner)
    this.bindSlot(owner, id)
    ++this.slotVersions[owner]
    const existing = this.holds(id) ? this.session(id) : undefined
    // A replay in flight already carries this open. A read-only attach (another client holds the
    // writer) is resumed again: the writer may have let go since.
    if (existing?.attached && !existing.restoring && !existing.readOnly && !this.lifecycle.operations.busy(id)) {
      this.followModel(owner, existing)
      return
    }
    await this.replayForOwner(id, cwd, owner)
  }

  /** A replay a slot asked for resolves the slot's model after the replay has started, so the session shows as restoring meanwhile. */
  private async replayForOwner(id: string, cwd: string, owner: DraftOwner): Promise<void> {
    this.openingOwners.set(id, owner)
    try {
      await this.replay(id, cwd)
    } finally {
      if (this.openingOwners.get(id) === owner) this.openingOwners.delete(id)
    }
  }

  /**
   * Every resume carries the session's model: the slot's choice when a slot opens it (resolved against the host's
   * applied providers once the replay is under way), the session's own selection otherwise.
   */
  protected override async requestContext(
    cwd: string,
    operation: SessionOperation,
    options: SessionRequestOptions
  ): ReturnType<CodexAcpClient<AppState>["requestContext"]> {
    if (operation.kind !== "resume" || (options.meta?.["alwith"] as { model?: unknown } | undefined)?.model !== undefined)
      return super.requestContext(cwd, operation, options)
    const id = operation.sessionId
    const owner = this.openingOwners.get(id)
    const session = this.holds(id) ? this.session(id) : undefined
    const model =
      owner !== undefined
        ? await this.resolveModel(this.slotModels[owner])
        : ((session ? selectedModel(session.configOptions) : null) ?? this.gatewayModels.get(id) ?? null)
    return super.requestContext(cwd, operation, { ...options, meta: mergeMeta(modelHint(model), options.meta) })
  }

  override setConfig(id: string, configId: string, value: string | boolean, owner: DraftOwner = "main"): Promise<void> {
    this.configOwners.set(`${id}:${configId}`, owner)
    return super.setConfig(id, configId, value)
  }

  protected override onConfigChanged(id: string, configId: string, response: acp.SetSessionConfigOptionResponse): void {
    super.onConfigChanged(id, configId, response)
    this.noteModel(this.session(id))
    const owner = this.configOwners.get(`${id}:${configId}`) ?? "main"
    this.configOwners.delete(`${id}:${configId}`)
    if (response.configOptions.some((option) => option.configId === configId && option.category === "model"))
      this.confirmModel(owner, this.session(id))
  }

  // ── Drafts ──

  /** Ownership changes are serialized independently of individual session operations. */
  private changeDraft<T>(owners: DraftOwner[], operation: () => Promise<T>): Promise<T> {
    const next = Promise.allSettled(
      owners.map((owner) => this.draftOperations.get(owner)).filter((operation) => operation !== undefined)
    ).then(operation)
    for (const owner of owners) this.draftOperations.set(owner, next)
    return next
  }

  prepareDraft(owner: DraftOwner, cwd: string, model: string | null = null): Promise<string> {
    const version = ++this.slotVersions[owner]
    return this.changeDraft([owner], async () => {
      const existing = Object.keys(this.state.draftSessions).find((id) => this.state.draftSessions[id] === owner)
      if (existing) await this.lifecycle.admission.pending(existing)
      if (
        existing &&
        this.session(existing).cwd === cwd &&
        (model === null || selectedModel(this.session(existing).configOptions) === model)
      ) {
        this.activateSlot(owner, existing, version)
        if (!this.session(existing).attached) await this.replayForOwner(existing, cwd, owner)
        if (model !== null) this.confirmModel(owner, this.session(existing))
        return existing
      }
      // Inherit the confirmed model, including a change already requested by this
      // surface. A failed change must not silently create a draft on the old model.
      // Prepare the replacement before retiring the previous draft: failures preserve the user's input.
      const id = await this.createNativeSession(
        cwd,
        await this.resolveModel(
          model ??
            (existing
              ? selectedModel(this.session(existing).configOptions)
              : (this.savedModels[owner] ?? this.slotModels[owner]))
        ),
        owner
      )
      try {
        // An unsent model change starts directly on the target provider. Resuming
        // the default-model thread creates a misleading model-change warning.
        if (existing && this.session(existing).cwd === cwd) {
          for (const option of this.session(existing).configOptions) {
            if (option.category === "model") continue
            const target = this.session(id).configOptions.find((entry) => entry.configId === option.configId)
            if (!target || target.currentValue === option.currentValue) continue
            if (isBooleanOption(option) && isBooleanOption(target)) {
              await this.setConfig(id, option.configId, option.currentValue)
            } else if (isSelectOption(option) && isSelectOption(target)) {
              const choices = isGroupedSelect(target.options)
                ? target.options.flatMap((group) => group.options)
                : target.options
              if (choices.some((choice) => choice.value === option.currentValue))
                await this.setConfig(id, option.configId, option.currentValue)
            }
          }
        }
        if (existing) await this.deleteEmptyDraft(existing)
      } catch (error) {
        await this.deleteEmptyDraft(id)
        throw error
      }
      this.activateSlot(owner, id, version)
      if (model !== null) this.confirmModel(owner, this.session(id))
      return id
    })
  }

  /** `discardDraft("main" | "chat")` drops that slot's draft; `discardDraft(id)` is the base client's form. */
  override discardDraft(owner: string): Promise<void> {
    if (owner !== "main" && owner !== "chat") return super.discardDraft(owner)
    return this.changeDraft([owner], async () => {
      for (const [id, current] of Object.entries(this.state.draftSessions))
        if (current === owner) await this.deleteEmptyDraft(id)
    })
  }

  transferDraft(id: string, owner: DraftOwner): Promise<void> {
    return this.changeDraft(["main", "chat"], async () => {
      if (!this.state.draftSessions[id] || this.state.draftSessions[id] === owner) return
      for (const [other, current] of Object.entries(this.state.draftSessions))
        if (current === owner) await this.deleteEmptyDraft(other)
      this.setApp((state) =>
        state.draftSessions[id] ? { draftSessions: { ...state.draftSessions, [id]: owner } } : {}
      )
    })
  }

  private deleteEmptyDraft(id: string): Promise<void> {
    return this.enqueueSession(id, async () => {
      if (!this.state.draftSessions[id]) return
      await this.delete(id)
      this.gatewayModels.delete(id)
    })
  }

  protected override onDraftMaterialized(id: string): void {
    super.onDraftMaterialized(id)
    this.setApp((state) => {
      const { [id]: _draft, ...draftSessions } = state.draftSessions
      return { draftSessions }
    })
    this.noteModel(this.session(id))
  }

  protected override onSessionDropped(id: string): void {
    super.onSessionDropped(id)
    this.gatewayModels.delete(id)
    this.setApp((state) => {
      const { [id]: _draft, ...draftSessions } = state.draftSessions
      const { [id]: _window, ...sessionWindows } = state.sessionWindows
      return { draftSessions, sessionWindows }
    })
  }

  // ── Fork with a counted title ──

  /** `fork(id, cwd, lastTurnId)` forks at a native turn; the options form is the base client's. */
  override fork(id: string, cwd: string, lastTurnId?: string | ForkOptions): Promise<string> {
    const options: ForkOptions = typeof lastTurnId === "object" ? lastTurnId : lastTurnId === undefined ? {} : { lastTurnId }
    return super.fork(id, cwd, options)
  }

  /** Runs inside the adapter's one-at-a-time fork lane: the title is counted against what is listed at that moment. */
  protected override async forkInternal(id: string, cwd: string, options: ForkOptions): Promise<string> {
    const indexes = await Promise.all([this.indexSessions(), this.indexSessions(undefined, true)])
    const known = [...indexes.flat(), ...this.state.sessionList, ...this.state.archivedSessions]
    const sourceTitle = (this.holds(id) ? this.session(id).title : null) ?? known.find((item) => item.sessionId === id)?.title
    const forked = await super.forkInternal(id, cwd, {
      ...options,
      meta: mergeMeta(modelHint(this.gatewayModels.get(id) ?? null), options.meta)
    })
    const title = sourceTitle ?? this.session(forked).title
    if (title)
      await this.renameSession(
        forked,
        forkTitle(
          title,
          known.flatMap((item) => (item.title ? [item.title] : []))
        )
      )
    return forked
  }

  protected override onForked(id: string, response: acp.ForkSessionResponse): void {
    super.onForked(id, response)
    this.noteModel(this.session(id))
  }

  protected override onReplayed(id: string, response: acp.ResumeSessionResponse): void {
    super.onReplayed(id, response)
    this.noteModel(this.session(id))
  }

  // ── Model memory per slot ──

  /** Desktop keeps explicit selections per chat slot, never in historical session bindings. */
  setModelSelections(models: Record<DraftOwner, string | null>): void {
    this.savedModels = { ...models }
    this.slotModels = { ...models }
  }

  onConfirmedModel(listener: (owner: DraftOwner, model: string) => void): () => void {
    this.confirmedModelListeners.add(listener)
    return () => this.confirmedModelListeners.delete(listener)
  }

  protected override onSessionChanged(session: Session): void {
    super.onSessionChanged(session)
    this.followModel("main", session)
    this.followModel("chat", session)
  }

  private followModel(owner: DraftOwner, session: Session): void {
    if (this.slotTargets[owner] !== session.id || !session.attached || session.restoring) return
    const model = selectedModel(session.configOptions)
    if (model !== null) this.slotModels[owner] = model
  }

  private activateSlot(owner: DraftOwner, id: string, version: number): void {
    if (this.slotVersions[owner] !== version) return
    this.bindSlot(owner, id)
    this.followModel(owner, this.session(id))
  }

  private bindSlot(owner: DraftOwner, id: string): void {
    // A conversation is handed between surfaces, never displayed in both at once.
    const other = owner === "main" ? "chat" : "main"
    if (this.slotTargets[other] === id) {
      this.slotTargets[other] = null
      ++this.slotVersions[other]
    }
    this.slotTargets[owner] = id
    this.setApp((state) => ({ sessionWindows: { ...state.sessionWindows, [id]: owner } }))
  }

  private confirmModel(owner: DraftOwner, session: Session): void {
    const model = selectedModel(session.configOptions)
    if (model === null) throw new Error("Model selection did not return the current model")
    this.followModel(owner, session)
    this.savedModels[owner] = model
    for (const listener of this.confirmedModelListeners) listener(owner, model)
  }

  private resolveModel(model: string | null): Promise<string | null> {
    return this.resolveModelOption ? this.resolveModelOption(model) : Promise.resolve(model)
  }

  onSessionModel(listener: SessionModelListener): () => void {
    this.modelListeners.add(listener)
    return () => this.modelListeners.delete(listener)
  }

  /** Reads the session's selected model and tells listeners whether it is a gateway model. */
  private noteModel(session: Session): void {
    const modelId = selectedModel(session.configOptions)
    if (modelId === null) return
    const option = session.configOptions.find((entry) => entry.category === "model" && entry.type === "select")
    const isGateway =
      option !== undefined &&
      isSelectOption(option) &&
      option.options.some(
        (group) =>
          "groupId" in group &&
          group.groupId !== NATIVE_MODEL_GROUP.id &&
          group.options.some((model) => model.value === modelId)
      )
    if (isGateway) this.gatewayModels.set(session.id, modelId)
    else this.gatewayModels.delete(session.id)
    if (!this.state.draftSessions[session.id])
      for (const listener of this.modelListeners) listener(session.id, modelId, isGateway)
  }
}
