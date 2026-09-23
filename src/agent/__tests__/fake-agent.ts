// In-process ACP v2 agent with just enough behaviour to exercise the client:
// async prompts, steering, permissions, cancellation, replay and archive.
import * as acp from "@agentclientprotocol/sdk/experimental/v2"

export type FakeAgent = {
  app: acp.AgentApp
  archived: Set<string>
  deleted: Set<string>
  /** The last `providers/set` params, `null` after every gateway is disabled. */
  gateway: { current: acp.SetProviderRequest | null }
  /** Registered gateways by `_meta.codex.id` (the adapter's catalog mode). */
  gateways: Map<string, acp.SetProviderRequest>
  /** `_meta.alwith.model` hints seen on session/new, session/resume and session/fork. */
  modelHints: Map<string, string | null>
  configDelay: { current: (() => Promise<void>) | null }
  listSessions: { current: ((request: acp.ListSessionsRequest) => acp.ListSessionsResponse) | null }
  configChanges: string[]
  /** Names set through `_codex/session_rename`. */
  renamed: Map<string, string>
  /** File search queries the client sent (`_codex/fuzzy_file_search`). */
  fileSearches: string[]
  /** Pushes a `_codex/rate_limits_updated` notification to the connected client. */
  pushRateLimits: (usedPercent: number) => Promise<void>
}

function modelHintOf(params: { _meta?: unknown }): string | null {
  const alwith = (params._meta as { alwith?: { model?: unknown } } | undefined)?.alwith
  return typeof alwith?.model === "string" ? alwith.model : null
}

type GatewayGroup = { id: string; name: string; models: string[] }

/** Model option as the adapter's catalog mode shapes it: a Codex group plus one group per gateway. */
function modelOption(current: string, gateways: GatewayGroup[]): acp.SessionConfigOption {
  return {
    configId: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: current,
    options: [
      { groupId: "codex", name: "Codex", options: [{ value: "gpt-5.6-sol", name: "GPT-5.6 Sol" }] },
      ...gateways.map(gateway => ({
        groupId: gateway.id,
        name: gateway.name,
        options: gateway.models.map(value => ({ value, name: value }))
      }))
    ]
  }
}

function gatewayIdOf(params: acp.SetProviderRequest | { _meta?: unknown }): string {
  const codex = (params._meta as { codex?: { id?: unknown } } | undefined)?.codex
  return typeof codex?.id === "string" ? codex.id : "custom-gateway"
}

export function createFakeAgent(): FakeAgent {
  const app = new acp.AgentApp()
  const active = new Map<string, AbortController>()
  const archived = new Set<string>()
  const deleted = new Set<string>()
  const gateway: FakeAgent["gateway"] = { current: null }
  const gateways: FakeAgent["gateways"] = new Map()
  const modelHints = new Map<string, string | null>()
  const configDelay: FakeAgent["configDelay"] = { current: null }
  const listSessions: FakeAgent["listSessions"] = { current: null }
  const configChanges: string[] = []
  const changingConfig = new Set<string>()
  const renamed = new Map<string, string>()
  const fileSearches: string[] = []
  let link: acp.AgentContext | null = null
  const gatewayGroups = (): GatewayGroup[] =>
    [...gateways.entries()].map(([id, params]) => {
      const meta = params._meta as
        { codex?: { name?: string }; alwith?: { models?: Array<{ id: string }> } } | undefined
      return { id, name: meta?.codex?.name ?? id, models: (meta?.alwith?.models ?? []).map(model => model.id) }
    })
  const optionsFor = (hint: string | null) => [modelOption(hint ?? "gpt-5.6-sol", gatewayGroups())]
  let next = 0
  const sessionId = () => `s${next++}`
  app.onRequest("initialize", ({ client }) => {
    link = client
    return {
      protocolVersion: 2,
      info: { name: "fake-codex", version: "1" },
      capabilities: {
        _meta: {
          codex: { archive: true, providerCatalog: true, rename: true, account: true, fuzzyFileSearch: true }
        }
      },
      authMethods: [{ type: "agent", methodId: "chat-gpt", name: "ChatGPT" }]
    }
  })
  const rateLimits = (usedPercent: number) => ({
    limitId: "weekly",
    limitName: "Weekly",
    primary: { usedPercent, windowDurationMins: 10080, resetsAt: 1_800_000_000 },
    secondary: null,
    credits: null,
    spendControlReached: null,
    planType: "plus"
  })
  app.onRequest(
    "_codex/session_rename",
    (value: unknown) => value as { sessionId: string; name: string },
    async ({ params, client }) => {
      renamed.set(params.sessionId, params.name)
      await client.notify("session/update", {
        sessionId: params.sessionId,
        update: { sessionUpdate: "session_info_update", title: params.name }
      })
      return {}
    }
  )
  app.onRequest(
    "_codex/account_read",
    () => ({}),
    () => ({ account: { type: "chatgpt", email: "ny@example.com", planType: "plus" }, requiresOpenaiAuth: true })
  )
  app.onRequest(
    "_codex/rate_limits",
    () => ({}),
    () => ({ rateLimits: rateLimits(40) })
  )
  app.onRequest(
    "_codex/fuzzy_file_search",
    (value: unknown) => value as { query: string; roots: string[] },
    ({ params }) => {
      fileSearches.push(params.query)
      const root = params.roots[0] ?? "/"
      const all = ["src/app.tsx", "src/agent/client.ts", "README.md"]
      const files = all
        .filter(path => path.toLowerCase().includes(params.query.toLowerCase()))
        .map(path => ({ root, path, match_type: "file", file_name: path.split("/").pop(), score: 1, indices: null }))
      return { files }
    }
  )
  const pushRateLimits = async (usedPercent: number) => {
    if (link === null) throw new Error("no client connected")
    await link.notify("_codex/rate_limits_updated" as never, { rateLimits: rateLimits(usedPercent) } as never)
  }
  app.onRequest("providers/set", ({ params }) => {
    gateway.current = params
    gateways.set(gatewayIdOf(params), params)
    return {}
  })
  app.onRequest("providers/disable", ({ params }) => {
    const codex = (params._meta as { codex?: { id?: unknown } } | undefined)?.codex
    if (typeof codex?.id === "string") gateways.delete(codex.id)
    else gateways.clear()
    if (gateways.size === 0) gateway.current = null
    return {}
  })
  app.onRequest("session/new", ({ params }) => {
    const hint = modelHintOf(params)
    const configuredGateway = hint !== null && gatewayGroups().some(group => group.models.includes(hint))
    if (params.cwd === "/needs-auth" && !configuredGateway) throw acp.RequestError.authRequired()
    const id = sessionId()
    modelHints.set(id, hint)
    return { sessionId: id, configOptions: optionsFor(hint) }
  })
  app.onRequest("session/list", ({ params }) => {
    if (listSessions.current !== null) return listSessions.current(params)
    const wantArchived =
      typeof params._meta?.codex === "object" && (params._meta.codex as { archived?: boolean }).archived === true
    return {
      sessions: [
        {
          sessionId: "h1",
          cwd: "/tmp/one",
          title: "First",
          _meta: { codex: { archived: false } }
        },
        {
          sessionId: "h2",
          cwd: "/tmp/two",
          title: "Second",
          _meta: { codex: { archived: true } }
        }
      ].filter(item => item._meta.codex.archived === wantArchived && !deleted.has(item.sessionId))
    }
  })
  app.onRequest("session/resume", async ({ params, client }) => {
    const hint = modelHintOf(params)
    modelHints.set(params.sessionId, hint)
    await client.notify("session/update", {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "user_message",
        messageId: "u",
        content: [{ type: "text", text: "history" }]
      }
    })
    await client.notify("session/update", {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message",
        messageId: "m",
        content: [{ type: "text", text: `restored:${params.sessionId}` }]
      }
    })
    return { configOptions: optionsFor(hint) }
  })
  app.onRequest("session/set_config_option", async ({ params }) => {
    if (changingConfig.has(params.sessionId))
      throw acp.RequestError.invalidRequest(
        { sessionId: params.sessionId },
        "Session lifecycle or configuration work is in progress"
      )
    changingConfig.add(params.sessionId)
    try {
      await configDelay.current?.()
      if (params.configId !== "model" || typeof params.value !== "string") throw acp.RequestError.invalidParams()
      configChanges.push(params.value)
      return { configOptions: optionsFor(params.value) }
    } finally {
      changingConfig.delete(params.sessionId)
    }
  })
  app.onRequest("session/prompt", async ({ params, client }) => {
    const id = params.sessionId
    const text = params.prompt.map(block => (block.type === "text" ? block.text : "")).join("")
    if (active.has(id)) return { _meta: { codex: { steered: "turn" } } }
    const controller = new AbortController()
    active.set(id, controller)
    const emit = (update: acp.SessionUpdate) => client.notify("session/update", { sessionId: id, update })
    await emit({ sessionUpdate: "state_update", state: "running" })
    void (async () => {
      try {
        await emit({
          sessionUpdate: "user_message",
          messageId: "u",
          content: [{ type: "text", text }]
        })
        if (text === "permission") {
          await emit({
            sessionUpdate: "state_update",
            state: "requires_action"
          })
          const answer = await client.request(
            "session/request_permission",
            {
              sessionId: id,
              title: "Run command?",
              options: [
                {
                  optionId: "allow_once",
                  name: "Allow once",
                  kind: "allow_once"
                },
                { optionId: "decline", name: "Decline", kind: "reject_once" }
              ]
            },
            { cancellationSignal: controller.signal }
          )
          await emit({ sessionUpdate: "state_update", state: "running" })
          await emit({
            sessionUpdate: "agent_message_chunk",
            messageId: "m",
            content: { type: "text", text: JSON.stringify(answer) }
          })
        } else if (text === "terminal") {
          await emit({
            sessionUpdate: "tool_call_update",
            toolCallId: "t1",
            name: "shell",
            title: "ls",
            kind: "execute",
            status: "in_progress",
            content: [{ type: "terminal", terminalId: "t1" }]
          })
          await emit({
            sessionUpdate: "terminal_update",
            terminalId: "t1",
            command: "ls"
          })
          const bytes = new TextEncoder().encode("héllo")
          await emit({
            sessionUpdate: "terminal_output_chunk",
            terminalId: "t1",
            data: btoa(String.fromCharCode(...bytes.slice(0, 2)))
          })
          await emit({
            sessionUpdate: "terminal_output_chunk",
            terminalId: "t1",
            data: btoa(String.fromCharCode(...bytes.slice(2)))
          })
          await emit({
            sessionUpdate: "tool_call_update",
            toolCallId: "t1",
            status: "completed"
          })
        } else {
          await Bun.sleep(80)
          if (!controller.signal.aborted)
            await emit({
              sessionUpdate: "agent_message_chunk",
              messageId: "m",
              content: { type: "text", text: `reply:${id}` }
            })
        }
      } catch {
      } finally {
        await emit({
          sessionUpdate: "state_update",
          state: "idle",
          stopReason: controller.signal.aborted ? "cancelled" : "end_turn"
        })
        active.delete(id)
      }
    })()
    return {}
  })
  app.onNotification("session/cancel", ({ params }) => {
    active.get(params.sessionId)?.abort()
  })
  app.onRequest(
    "_codex/session_archive",
    (value: unknown) => value as { sessionId: string },
    ({ params }) => {
      archived.add(params.sessionId)
      return {}
    }
  )
  app.onRequest("session/delete", ({ params }) => {
    deleted.add(params.sessionId)
    return {}
  })
  return {
    app,
    archived,
    deleted,
    gateway,
    gateways,
    modelHints,
    configDelay,
    listSessions,
    configChanges,
    renamed,
    fileSearches,
    pushRateLimits
  }
}
