import { afterEach, expect, test } from "bun:test"
import { isSelectOption, textOf } from "@alwith/api"
import { must } from "@/lib/__tests__/must"
import { CodexClient, type GatewayModel } from "../client"
import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

/**
 * `providers/set` in catalog mode (codex-acp-v2 0.5.0): the gateway's models join every
 * session's `model` option as their own group and a session moves to the gateway only when
 * one of them is selected. Nothing global changes.
 */
type GatewayConfig = {
  /** Gateway id (`_meta.codex.id`); one `model_providers` entry and one picker group per id. */
  id: string
  name: string
  baseUrl: string
  bearerToken: string
  models: GatewayModel[]
  /** Extra Codex thread-config keys applied only to threads on the gateway. */
  config: Record<string, unknown>
}

// Native host owns provider registration; tests configure the in-process engine through its port.
async function registerGateway(port: FakeHubPort, gateway: GatewayConfig) {
  await port.acpRequest("codex", "providers/set", {
    providerId: "openai",
    apiType: "openai",
    baseUrl: gateway.baseUrl,
    _meta: {
      codex: {
        id: gateway.id,
        mode: "catalog",
        name: gateway.name,
        bearerToken: gateway.bearerToken,
        config: gateway.config
      },
      alwith: { models: gateway.models }
    }
  })
}
async function unregisterGateway(port: FakeHubPort, id: string) {
  await port.acpRequest("codex", "providers/disable", { providerId: "openai", _meta: { codex: { id } } })
}

const clients: CodexClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect()
})

async function make() {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  clients.push(client)
  await client.connect()
  return { client, fake, port }
}

async function until(predicate: () => boolean) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > 3000) throw new Error("Timed out")
    await Bun.sleep(5)
  }
}

test("fork sends the real turn boundary, keeps model hints and preserves replayed title and lineage", async () => {
  const { client, fake, port } = await make()
  await registerGateway(port, {
    id: "gateway",
    name: "Gateway",
    baseUrl: "https://example.com/v1",
    bearerToken: "test",
    models: [{ id: "custom-model" }],
    config: {}
  })
  const source = await client.newSession("/tmp/fork", "custom-model")
  fake.replayUpdates.push(
    { sessionUpdate: "session_info_update", title: "Original title" },
    {
      sessionUpdate: "agent_message",
      messageId: "answer-item",
      content: [{ type: "text", text: "Kept answer" }],
      _meta: { codex: { turnId: "turn-1", phase: "final_answer" } }
    }
  )
  const forked = await client.fork(source, "/tmp/fork", "turn-1")
  expect(fake.forks[0]).toMatchObject({
    sessionId: source,
    _meta: { codex: { lastTurnId: "turn-1" }, alwith: { model: "custom-model" } }
  })
  expect(client.state.threads.find(thread => thread.sessionId === forked)).toMatchObject({
    title: "Original title (2)",
    nativeSessionId: forked,
    forkedFromId: source
  })
  expect(
    client.session(forked).items.some(item => item.kind === "assistant" && textOf(item.content) === "Kept answer")
  ).toBe(true)
  expect(client.session(source).items).toHaveLength(0)
  expect(client.session(forked).items.every(item => item.replayed)).toBe(true)
  client.store.setState({ agent: { info: { name: "test", version: "1" }, protocolVersion: 2 } })
  await expect(client.fork(source, "/tmp/fork", "turn-1")).rejects.toThrow("does not support")
  expect(fake.forks).toHaveLength(1)
})

test("fork titles are saved immediately, collisions are skipped, and the boundary survives reopening", async () => {
  const { client, fake } = await make()
  const source = await client.newSession("/tmp/titles")
  await client.renameSession(source, "Review")
  fake.listSessions.current = () => ({ sessions: [{ sessionId: "existing", cwd: "/tmp/titles", title: "Review (2)" }] })
  const [first, second] = await Promise.all([
    client.fork(source, "/tmp/titles", "t1"),
    client.fork(source, "/tmp/titles", "t1")
  ])
  expect(fake.renamed.get(first)).toBe("Review (3)")
  expect(fake.renamed.get(second)).toBe("Review (4)")
  expect(client.session(source).title).toBe("Review")
  expect(client.state.forkOrigins[first]).toEqual({ sourceId: source, boundaryTurnId: "t1" })
  await client.close(first)
  await client.open(first, "/tmp/titles")
  expect(client.state.forkOrigins[first]).toEqual({ sourceId: source, boundaryTurnId: "t1" })
  const nested = await client.fork(second, "/tmp/titles", "t1")
  expect(fake.renamed.get(nested)).toBe("Review (5)")
})

test("source lookup reads every page across projects and archived chats and rejects cyclic results", async () => {
  const { client, fake } = await make()
  const entry = (id: string, parent: string | null, cwd: string, archived = false) => ({
    sessionId: id,
    cwd,
    _meta: { codex: { nativeSessionId: id, forkedFromId: parent, archived } }
  })
  const before = client.state.threads
  const requests: unknown[] = []
  fake.listSessions.current = request => {
    requests.push(request)
    if (request._meta) return { sessions: [entry("archived-parent", "root", "/old", true)] }
    return request.cursor === "next"
      ? {
          sessions: [entry("branch", "archived-parent", "/other"), entry("sibling", "root", "/project")],
          nextCursor: null
        }
      : { sessions: [entry("root", null, "/project"), entry("unrelated", null, "/project")], nextCursor: "next" }
  }
  expect((await client.readThreadSummary("branch"))?.cwd).toBe("/other")
  expect(requests).toContainEqual({ _meta: { codex: { archived: true } } })
  expect(requests).toContainEqual({ cursor: "next" })
  expect((await client.readThreadSummary("archived-parent"))?.archived).toBe(true)
  expect(client.state.threads).toBe(before)
  fake.listSessions.current = () => ({ sessions: [], nextCursor: "cycle" })
  await expect(client.readThreadSummary("root")).rejects.toThrow("repeated cursor")
})

test("a newly forked attached chat remains selectable before Codex lists it", async () => {
  const { client, fake } = await make()
  const root = await client.newSession("/tmp/fork")
  fake.listSessions.current = request =>
    request._meta
      ? { sessions: [] }
      : {
          sessions: [
            { sessionId: root, cwd: "/tmp/fork", _meta: { codex: { nativeSessionId: root, forkedFromId: null } } }
          ]
        }
  const child = await client.fork(root, "/tmp/fork", "turn-1")
  await client.listThreads({ reset: true })
  expect(client.state.threads.some(thread => thread.sessionId === child)).toBe(true)
  expect((await client.listProjectThreads("/tmp/fork")).some(thread => thread.sessionId === child)).toBe(true)
  await client.delete(child)
  expect((await client.listProjectThreads("/tmp/fork")).some(thread => thread.sessionId === child)).toBe(false)
})

test("stream bursts preserve every chunk across sessions with bounded UI notifications", async () => {
  const { client, fake } = await make()
  const a = await client.newSession("/tmp/a")
  const b = await client.newSession("/tmp/b")
  let notifications = 0
  const stop = client.store.subscribe(() => notifications++)
  for (let i = 0; i < 400; i++) {
    await fake.pushUpdate(i % 2 === 0 ? a : b, {
      sessionUpdate: "agent_thought_chunk",
      messageId: "thought",
      content: { type: "text", text: `${i},` }
    })
  }
  const expected = (parity: number) => Array.from({ length: 200 }, (_, i) => `${i * 2 + parity},`).join("")
  await until(
    () =>
      client.state.sessions[b]?.items.some(item => item.kind === "thought" && textOf(item.content) === expected(1)) ===
      true
  )
  stop()
  for (const [id, parity] of [
    [a, 0],
    [b, 1]
  ] as const) {
    const item = client.state.sessions[id].items.find(item => item.kind === "thought")
    expect(item?.kind === "thought" && textOf(item.content)).toBe(expected(parity))
    expect(client.state.sessions[id]).toBe(client.session(id))
  }
  expect(notifications).toBeLessThan(40)
})

test("completion publishes pending chunks and disconnect cannot restore a stale attached session", async () => {
  const { client, fake } = await make()
  const id = await client.newSession("/tmp/a")
  await fake.pushUpdate(id, { sessionUpdate: "state_update", state: "running" })
  await fake.pushUpdate(id, {
    sessionUpdate: "agent_message_chunk",
    messageId: "answer",
    content: { type: "text", text: "complete" }
  })
  await fake.pushUpdate(id, { sessionUpdate: "state_update", state: "idle", stopReason: "end_turn" })
  await until(() => client.session(id).state === "idle")
  expect(client.state.sessions[id]).toBe(client.session(id))
  expect(
    client.state.sessions[id].items.some(item => item.kind === "assistant" && textOf(item.content) === "complete")
  ).toBe(true)
  await fake.pushUpdate(id, {
    sessionUpdate: "agent_message_chunk",
    messageId: "answer",
    content: { type: "text", text: "!" }
  })
  client.disconnect()
  await Bun.sleep(25)
  expect(client.state.sessions[id].attached).toBe(false)
})

test("history replay batches complete upserts and publishes the full transcript before open resolves", async () => {
  const { client, fake } = await make()
  for (let i = 0; i < 400; i++) {
    fake.replayUpdates.push({
      sessionUpdate: "agent_message",
      messageId: `history-${i}`,
      content: [{ type: "text", text: `restored ${i}` }]
    })
  }
  let notifications = 0
  let publishedWhileRestoring = 0
  const stop = client.store.subscribe(state => {
    notifications++
    if (state.sessions.h1?.restoring && state.sessions.h1.items.length > 0) publishedWhileRestoring++
  })
  await client.open("h1", "/tmp/one")
  stop()
  expect(client.state.sessions.h1.items).toHaveLength(402)
  expect(client.state.sessions.h1.restoring).toBe(false)
  expect(client.state.sessions.h1).toBe(client.session("h1"))
  // Replayed frames fold silently; only the finished transcript is published.
  expect(publishedWhileRestoring).toBe(0)
  expect(notifications).toBeLessThan(10)
})

test("prompt acknowledgement is not completion; cancelling one session leaves the other running", async () => {
  const { client } = await make()
  const [a, b] = await Promise.all([client.newSession("/tmp/a"), client.newSession("/tmp/b")])
  await Promise.all([
    client.prompt(a, [{ type: "text", text: "one" }]),
    client.prompt(b, [{ type: "text", text: "two" }])
  ])
  expect(client.session(a).state).toBe("running")
  expect(client.session(b).state).toBe("running")
  await client.cancel(a)
  await until(() => client.session(a).state === "idle" && client.session(b).state === "idle")
  expect(client.session(a).items.some(item => item.kind === "assistant")).toBe(false)
  const reply = client.session(b).items.find(item => item.kind === "assistant")
  expect(reply?.kind === "assistant" && reply.content[0]?.type === "text" ? reply.content[0].text : "").toBe(
    `reply:${b}`
  )
  expect(client.state.sessions[b]).toBe(client.session(b))
})

test("permission requests surface as actions and resolve back to the agent", async () => {
  const { client } = await make()
  const id = await client.newSession("/tmp/a")
  await client.prompt(id, [{ type: "text", text: "permission" }])
  await until(() => client.state.actions.length === 1)
  const action = client.state.actions[0]
  expect(action.kind).toBe("permission")
  expect(client.session(id).state).toBe("requires_action")
  expect(() =>
    client.respond(action.id, {
      outcome: { outcome: "selected", optionId: "nope" }
    })
  ).toThrow()
  client.respond(action.id, {
    outcome: { outcome: "selected", optionId: "allow_once" }
  })
  await until(() => client.session(id).state === "idle")
  expect(client.state.actions).toHaveLength(0)
  const reply = client.session(id).items.find(item => item.kind === "assistant")
  expect(reply?.kind === "assistant" && reply.content[0]?.type === "text" ? reply.content[0].text : "").toContain(
    "allow_once"
  )
})

test("terminal output is decoded across chunk boundaries", async () => {
  const { client } = await make()
  const id = await client.newSession("/tmp/a")
  await client.prompt(id, [{ type: "text", text: "terminal" }])
  await until(() => client.session(id).state === "idle")
  expect(client.session(id).terminals.t1?.output).toBe("héllo")
  const tool = client.session(id).items.find(item => item.kind === "tool")
  expect(tool?.kind === "tool" ? tool.status : null).toBe("completed")
})

test("threads come from the agent and open() replays history", async () => {
  const { client, fake } = await make()
  await client.listThreads()
  expect(client.state.threads.map(thread => thread.sessionId)).toEqual(["h1"])
  await client.listThreads({ archived: true })
  expect(client.state.archivedThreads.map(thread => thread.sessionId)).toEqual(["h2"])
  await client.open("h1", "/tmp/one")
  const session = client.session("h1")
  expect(session.attached).toBe(true)
  expect(session.items.map(item => item.kind)).toEqual(["user", "assistant"])
  await client.archive("h1")
  expect(fake.archived.has("h1")).toBe(true)
  expect(client.state.threads).toHaveLength(0)
  expect(client.state.archivedThreads.map(thread => thread.sessionId)).toEqual(["h1", "h2"])
  expect(client.state.sessions.h1).toBeUndefined()
})

test("project query reads every page, deduplicates IDs and leaves sidebar pagination untouched", async () => {
  const { client, fake } = await make()
  await client.listThreads()
  const before = client.state
  const requests: Array<{ cwd?: string | null; cursor?: string | null }> = []
  fake.listSessions.current = params => {
    requests.push(params)
    if (!params.cursor) return { sessions: [{ sessionId: "p1", cwd: "/tmp/project", title: "Old" }], nextCursor: "p2" }
    if (params.cursor === "p2") return { sessions: [], nextCursor: "p3" }
    return {
      sessions: [
        { sessionId: "p1", cwd: "/tmp/project", title: "Renamed" },
        { sessionId: "p2", cwd: "/tmp/project", title: "Second" },
        { sessionId: "foreign", cwd: "/tmp/other" },
        { sessionId: "archived", cwd: "/tmp/project", _meta: { codex: { archived: true } } }
      ]
    }
  }
  const result = await client.listProjectThreads("/tmp/project")
  expect(requests.map(request => [request.cwd, request.cursor])).toEqual([
    ["/tmp/project", undefined],
    ["/tmp/project", "p2"],
    ["/tmp/project", "p3"]
  ])
  expect(result.map(thread => [thread.sessionId, thread.title])).toEqual([
    ["p1", "Renamed"],
    ["p2", "Second"]
  ])
  expect(client.state).toBe(before)
})

test("project query rejects failed or cyclic pagination instead of returning an incomplete total", async () => {
  const { client, fake } = await make()
  fake.listSessions.current = params => {
    if (params.cursor) throw new Error("Page unavailable")
    return { sessions: [{ sessionId: "p1", cwd: "/tmp/project" }], nextCursor: "again" }
  }
  await expect(client.listProjectThreads("/tmp/project")).rejects.toThrow("Internal error")
  fake.listSessions.current = () => ({ sessions: [], nextCursor: "again" })
  await expect(client.listProjectThreads("/tmp/project")).rejects.toThrow("repeated cursor")
})

test("thread loading reports failure and clears it after retry", async () => {
  const { client, fake } = await make()
  let answer: ((value: { sessions: [] }) => void) | null = null
  let attempts = 0
  fake.listSessions.current = async () => {
    attempts += 1
    if (attempts === 1) throw new Error("list unavailable")
    return await new Promise<{ sessions: [] }>(resolve => {
      answer = resolve
    })
  }

  await expect(client.listThreads({ reset: true })).rejects.toThrow("Internal error")
  expect(client.state.threadsLoaded).toBe(false)
  expect(client.state.threadsLoading).toBe(false)
  expect(client.state.threadsError).toContain("Internal error")

  const retry = client.listThreads({ reset: true })
  expect(client.state.threadsLoading).toBe(true)
  expect(client.state.threadsError).toBeNull()
  await until(() => answer !== null)
  const respond = answer as ((value: { sessions: [] }) => void) | null
  if (respond === null) throw new Error("The retry did not reach the agent")
  respond({ sessions: [] })
  await retry
  expect(client.state.threadsLoaded).toBe(true)
  expect(client.state.threadsLoading).toBe(false)
  expect(client.state.threads).toEqual([])
})

test("a gap the client could not refill replays the whole session from the engine's record", async () => {
  const { client, port } = await make()
  await client.open("h1", "/tmp/one")
  expect(client.session("h1").items.map(item => item.kind)).toEqual(["user", "assistant"])
  // The Runtime journal no longer had frames 3..5: what we hold is not continuous any more.
  for (const handler of port.gapHandlers) handler({ sessionId: "h1", from: 3, to: 5 })
  expect(client.session("h1").restoring).toBe(true)
  await until(() => !client.session("h1").restoring)
  // Replayed, not appended: the old projection was cleared first.
  expect(client.session("h1").items.map(item => item.kind)).toEqual(["user", "assistant"])
  expect(client.session("h1").attached).toBe(true)
})

test("authentication errors propagate from session/new", async () => {
  const { client } = await make()
  await expect(client.newSession("/needs-auth")).rejects.toThrow()
})

test("a configured gateway can create a chat without signing in to Codex", async () => {
  const { client, fake, port } = await make()
  await registerGateway(port, {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/",
    bearerToken: "test-only",
    models: [{ id: "deepseek-flash", label: "DeepSeek-Flash" }],
    config: {}
  })
  await expect(client.newSession("/needs-auth")).rejects.toThrow()
  const id = await client.newSession("/needs-auth", "deepseek-flash")
  expect(fake.modelHints.get(id)).toBe("deepseek-flash")
  expect(client.session(id).attached).toBe(true)
})

test("host configured gateway models are identified from the session catalog and resumed with the model hint", async () => {
  const { client, fake, port } = await make()
  expect(client.providerCatalog).toBe(true)
  await registerGateway(port, {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/",
    bearerToken: "sk-test",
    models: [{ id: "deepseek-flash", label: "DeepSeek-Flash" }],
    config: { model_catalog_json: "/models.json", web_search: "disabled" }
  })
  const sent = must(fake.gateway.current, "a gateway request")
  expect(sent.providerId).toBe("openai")
  expect(sent.baseUrl).toBe("https://api.deepseek.com/")
  expect(sent._meta).toEqual({
    codex: {
      id: "deepseek",
      mode: "catalog",
      name: "DeepSeek",
      bearerToken: "sk-test",
      config: { model_catalog_json: "/models.json", web_search: "disabled" }
    },
    alwith: { models: [{ id: "deepseek-flash", label: "DeepSeek-Flash" }] }
  })

  // A thread the user moved to DeepSeek earlier is asked for on resume; others are not.
  const seen: Array<[string, string, boolean]> = []
  client.onSessionModel((sessionId, modelId, isGateway) => seen.push([sessionId, modelId, isGateway]))
  client.setGatewayModels({ h1: "deepseek-flash" })
  await client.open("h1", "/tmp/one")
  await client.open("h2", "/tmp/two")
  expect(fake.modelHints.get("h1")).toBe("deepseek-flash")
  expect(fake.modelHints.get("h2")).toBeNull()
  expect(seen).toEqual([
    ["h1", "deepseek-flash", true],
    ["h2", "gpt-5.6-sol", false]
  ])

  // New chats start native; a gateway model can be asked for explicitly.
  const native = await client.newSession("/tmp/n")
  const moved = await client.newSession("/tmp/m", "deepseek-flash")
  expect(fake.modelHints.get(native)).toBeNull()
  expect(fake.modelHints.get(moved)).toBe("deepseek-flash")

  await unregisterGateway(port, "deepseek")
  expect(fake.gateway.current).toBeNull()
})

test("model changes after restoring a session wait for the previous configuration change", async () => {
  const { client, fake, port } = await make()
  await registerGateway(port, {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/",
    bearerToken: "test-only",
    models: [{ id: "deepseek-flash" }],
    config: {}
  })
  await client.open("h1", "/tmp/one")

  let releaseFirst!: () => void
  const firstBlocked = new Promise<void>(resolve => {
    releaseFirst = resolve
  })
  let enteredFirst = false
  fake.configDelay.current = async () => {
    if (enteredFirst) return
    enteredFirst = true
    await firstBlocked
  }

  const first = client.setConfig("h1", "model", "deepseek-flash")
  await until(() => enteredFirst)
  const second = client.setConfig("h1", "model", "gpt-5.6-sol")
  const results = Promise.allSettled([first, second])
  await Bun.sleep(20)
  releaseFirst()
  expect(await results).toEqual([
    { status: "fulfilled", value: undefined },
    { status: "fulfilled", value: undefined }
  ])
  expect(fake.configChanges).toEqual(["deepseek-flash", "gpt-5.6-sol"])
  const model = client.session("h1").configOptions.find(option => option.configId === "model")
  expect(model?.currentValue).toBe("gpt-5.6-sol")
})

test("several gateways register under their own ids and can be removed one at a time", async () => {
  const { client, fake, port } = await make()
  await registerGateway(port, {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/",
    bearerToken: "sk-a",
    models: [{ id: "deepseek-flash", label: "DeepSeek-Flash" }],
    config: {}
  })
  await registerGateway(port, {
    id: "xai",
    name: "xAI",
    baseUrl: "https://api.x.ai/v1",
    bearerToken: "xai-b",
    models: [{ id: "grok-4.6", label: "Grok 4.6" }],
    config: {}
  })
  expect([...fake.gateways.keys()]).toEqual(["deepseek", "xai"])

  // Every session's model option carries one group per gateway after Codex's own.
  const id = await client.newSession("/tmp/g")
  const option = client.session(id).configOptions.find(entry => entry.configId === "model")
  if (option === undefined || !isSelectOption(option)) throw new Error("model option missing")
  const groupIds = option.options.map(group => ("groupId" in group ? group.groupId : ""))
  expect(groupIds).toEqual(["chatgpt", "deepseek", "xai"])

  // A model of the second gateway counts as a gateway model.
  const seen: Array<[string, boolean]> = []
  client.onSessionModel((_sessionId, modelId, isGateway) => seen.push([modelId, isGateway]))
  const moved = await client.newSession("/tmp/x", "grok-4.6")
  expect(fake.modelHints.get(moved)).toBe("grok-4.6")
  expect(seen.at(-1)).toEqual(["grok-4.6", true])

  await unregisterGateway(port, "xai")
  expect([...fake.gateways.keys()]).toEqual(["deepseek"])
  expect(fake.gateway.current).not.toBeNull()
  await unregisterGateway(port, "deepseek")
  expect(fake.gateway.current).toBeNull()
})

test("rename, account, rate limits and file search pass through the adapter's _codex methods", async () => {
  const { client, fake } = await make()
  await client.listThreads({ reset: true })
  await client.renameSession("h1", "Renamed")
  expect(fake.renamed.get("h1")).toBe("Renamed")
  expect(client.state.threads.find(thread => thread.sessionId === "h1")?.title).toBe("Renamed")

  const account = await client.readAccount()
  expect(account.account).toEqual({ type: "chatgpt", email: "ny@example.com", planType: "plus" })
  const limits = await client.readRateLimits()
  expect(limits.primary?.usedPercent).toBe(40)

  const seen: number[] = []
  const stop = client.onRateLimits(update => seen.push(update.primary?.usedPercent ?? -1))
  await fake.pushRateLimits(65)
  await until(() => seen.length === 1)
  expect(seen).toEqual([65])
  stop()

  const found = await client.fuzzyFileSearch({ query: "client", roots: ["/tmp/one"] })
  expect(fake.fileSearches).toEqual(["client"])
  expect(found.files.map(file => file.path)).toEqual(["src/agent/client.ts"])
})

test("the user's message is on screen before Codex reports it; the receipt claims it, the echo adopts it", async () => {
  const { client } = await make()
  const id = await client.newSession("/tmp/a")
  const sending = client.prompt(id, [{ type: "text", text: "shown at once" }])
  const local = client.session(id).items.find(item => item.kind === "user")
  expect(local?.kind === "user" ? local.echo : null).toBe("pending")
  await sending
  const claimed = client.session(id).items.find(item => item.kind === "user")
  expect(claimed?.id).toBe("u")
  expect(claimed?.kind === "user" ? claimed.echo : null).toMatch(/^(acknowledged|adopted)$/)
  await until(() => client.session(id).state === "idle")
  const users = client.session(id).items.filter(item => item.kind === "user")
  expect(users).toHaveLength(1)
  expect(users[0]?.id).toBe("u")
  expect(users[0]?.kind === "user" ? users[0].echo : null).toBe("adopted")
})

test("Stop answers the session's pending permission with cancelled before session/cancel — no zombie prompt on the next attach", async () => {
  const { client } = await make()
  const id = await client.newSession("/tmp/a")
  await client.prompt(id, [{ type: "text", text: "permission" }])
  await until(() => client.state.actions.length === 1)
  await client.cancel(id)
  expect(client.state.actions).toEqual([])
  await until(() => client.session(id).state === "idle")
  const reply = client.session(id).items.find(item => item.kind === "assistant")
  // the fake echoes the answer it got as JSON text
  expect(JSON.stringify(reply)).toContain("cancelled")
})
