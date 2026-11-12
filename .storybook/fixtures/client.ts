import type { SessionRunState } from "@alwith/api"
import type { Session } from "@alwith/module-chat/client"
import { applyUpdate, codexTurnId, createSession, isSelectOption, isText } from "@alwith/module-chat/client"
import { useStore } from "zustand"

import { type AppState, CodexClient } from "../../src/agent/client"
import { forkTitle } from "../../src/agent/fork-title"
import {
  assistantMessage,
  configOptions,
  FIXED_TIME,
  makeSession,
  makeThreads,
  OTHER_DIRECTORY,
  pendingAction,
  PROJECT_DIRECTORY,
  QUICK_DIRECTORY,
  userMessage
} from "./catalog"

// Only the UI projection is used. No preview can acquire a native Runtime connection.
export const client = new CodexClient(
  () => {
    return Promise.reject(new Error("Native Runtime is disabled in Storybook"))
  },
  {
    agentId: "storybook",
    launch: { engine: "storybook" }
  }
)
const projectContext = {
  homeDirectory: "/Users/demo",
  codexChatDirectory: QUICK_DIRECTORY,
  chatDirectory: QUICK_DIRECTORY,
  projects: [PROJECT_DIRECTORY, OTHER_DIRECTORY].map((path, index) => ({
    id: `preview-project-${index}`,
    name: path.split("/").at(-1)!,
    roots: [{ path }],
    metadata: {},
    position: index,
    createdAt: 0,
    updatedAt: 0,
    recencyAt: null
  }))
}
const initialState = client.state
let connectionCase = "ready"
let sequence = 0
let response: "complete" | "permission" | "question" | "error" = "complete"
let draftFailure: string | null = null
let draftFailureCode: number | null = -32000
let timers: ReturnType<typeof setTimeout>[] = []
export const actionsTaken: { type: string; id: string; value?: unknown }[] = []
export function runState(id: string, state: SessionRunState["state"]): SessionRunState {
  return {
    sessionId: id,
    state,
    since: Date.parse(FIXED_TIME),
    version: sequence,
    interruption: null,
    reusableDraft: false,
    owner: "storybook",
    cwd: client.state.sessions[id]?.cwd ?? "",
    title: client.state.sessions[id]?.title ?? "新聊天",
    tasks: [],
    listeningPorts: [],
    executionId: null,
    executionRole: null,
    lastActivityAt: Date.parse(FIXED_TIME)
  }
}

function publish(session: Session): void {
  client.store.setState((state) => ({ sessions: { ...state.sessions, [session.id]: session } }))
}
function later(callback: () => void, delay: number): void {
  timers.push(setTimeout(callback, delay))
}
function finish(id: string, text = "检查已完成，交付清单已更新。你可以继续打开项目文件查看结果。"): void {
  const session = client.state.sessions[id]
  if (!session) return
  publish({ ...assistantMessage(session, text, `${id}-answer-${sequence}`), state: "idle" })
  client.store.setState((state) => ({ runStates: { ...state.runStates, [id]: runState(id, "done") } }))
}
export function resetClient(
  options: {
    connection?: string
    response?: typeof response
    draftFailure?: string | null
    draftFailureCode?: number | null
  } = {}
): void {
  client.unarchive = unarchive
  client.delete = deleteSession
  client.installedApps = async () => ({
    apps: [
      { id: "preview-figma", runtimeName: "Figma", enabled: true, callable: true },
      { id: "preview-sites", runtimeName: "Sites", enabled: true, callable: true }
    ]
  })
  for (const timer of timers) clearTimeout(timer)
  timers = []
  connectionCase = options.connection ?? "ready"
  sequence = 0
  response = options.response ?? "complete"
  draftFailure = options.draftFailure ?? null
  draftFailureCode = options.draftFailureCode === undefined ? -32000 : options.draftFailureCode
  client.listSessions = async () => {}
  client.listArchived = async () => {}
  actionsTaken.length = 0
  const threads = makeThreads()
  const sessions = Object.fromEntries(
    ["conversation", "running", "permission"].map((kind) => [
      kind,
      makeSession(kind as "conversation" | "running" | "permission")
    ])
  )
  client.store.setState(
    {
      ...initialState,
      connection: "ready",
      sessions,
      sessionList: threads,
      projectContext,
      sessionListLoaded: true,
      archivedLoaded: true,
      archivedSessions: threads
        .slice(10, 16)
        .map((thread, index) => ({ ...thread, sessionId: `archive-${index}`, archived: true })),
      agent: {
        protocolVersion: 2,
        info: { name: "Codex", version: "0.164.0" },
        authMethods: [
          { type: "agent", methodId: "chat-gpt", name: "ChatGPT" },
          { type: "agent", methodId: "chat-gpt-device-code", name: "Device code" },
          { type: "agent", methodId: "api-key", name: "API key" }
        ],
        capabilities: {
          session: { fork: {} },
          _meta: {
            codex: {
              archive: true,
              rename: true,
              account: true,
              skills: true,
              plugins: true,
              fuzzyFileSearch: true,
              sessionLineage: true,
              forkAtTurn: true,
              sessionRetry: { version: 1 },
              composerPredictions: true
            }
          }
        }
      },
      runStates: {
        running: runState("running", "running"),
        permission: runState("permission", "requires_action"),
        conversation: runState("conversation", "done")
      }
    },
    true
  )
}
client.session = (id) => {
  const session = client.state.sessions[id]
  if (!session) throw new Error(`Missing preview session: ${id}`)
  return session
}
client.disconnect = () => {}
export function restoreConnection(): void {
  connectionCase = "ready"
}
client.connect = async () => {
  if (connectionCase === "connecting") return new Promise(() => {})
  if (["failed", "disconnected"].includes(connectionCase)) throw new Error("模拟连接中断，请重试。")
  client.store.setState({ connection: "ready", connectionError: null })
}
client.listSessions = async () => {}
client.listArchived = async () => {}
client.refreshProjectContext = async () => projectContext
client.listProjectSessions = async (cwd) => client.state.sessionList.filter((thread) => thread.cwd === cwd)
client.listHistorySessions = async () => [...client.state.sessionList, ...client.state.archivedSessions]
client.readSessionSummary = async (id) => client.state.sessionList.find((thread) => thread.sessionId === id) ?? null
client.activityReply = async () => "页面与交互检查已完成，交付资料已经更新。"
client.prepareDraft = async (owner, cwd, model) => {
  if (draftFailure)
    throw Object.assign(new Error(draftFailure), draftFailureCode === null ? {} : { code: draftFailureCode })
  const previous = Object.keys(client.state.draftSessions).find(
    (id) =>
      client.state.draftSessions[id] === owner &&
      client.state.sessions[id]?.cwd === cwd &&
      (!model ||
        client.state.sessions[id]?.configOptions.some(
          (option) => option.category === "model" && option.currentValue === model
        ))
  )
  if (previous) return Promise.resolve(previous)
  const id = `draft-${owner}-${++sequence}`
  const session = {
    ...createSession(id, cwd ?? QUICK_DIRECTORY),
    attached: true,
    configOptions: configOptions.map((option) =>
      isSelectOption(option) && option.category === "model" && model ? { ...option, currentValue: model } : option
    )
  }
  client.store.setState((state) => {
    const retired = new Set(Object.keys(state.draftSessions).filter((key) => state.draftSessions[key] === owner))
    return {
      sessions: {
        ...Object.fromEntries(Object.entries(state.sessions).filter(([key]) => !retired.has(key))),
        [id]: session
      },
      draftSessions: {
        ...Object.fromEntries(Object.entries(state.draftSessions).filter(([, value]) => value !== owner)),
        [id]: owner
      }
    }
  })
  return Promise.resolve(id)
}
client.discardDraft = (owner) => {
  client.store.setState((state) => ({
    draftSessions: Object.fromEntries(Object.entries(state.draftSessions).filter(([, current]) => current !== owner))
  }))
  return Promise.resolve()
}
client.transferDraft = (id, owner) => {
  if (!(id in client.state.draftSessions)) return Promise.resolve()
  client.store.setState((state) => ({
    draftSessions: {
      ...Object.fromEntries(Object.entries(state.draftSessions).filter(([, value]) => value !== owner)),
      [id]: owner
    }
  }))
  return Promise.resolve()
}
client.newSession = async (cwd, model, owner = "main") =>
  client.prepareDraft(owner, cwd, typeof model === "string" ? model : null)
client.open = (id, cwd) => {
  publish({ ...(client.state.sessions[id] ?? makeSession("conversation", id)), cwd, attached: true, restoring: false })
  return Promise.resolve()
}
client.prompt = (id, prompt) => {
  const current = client.session(id)
  const text = prompt
    .filter(isText)
    .map((block) => block.text)
    .join("\n")
  const index = ++sequence
  publish({
    ...userMessage(current, text, `${id}-user-${index}`),
    state: "running",
    title: current.title ?? text.slice(0, 40)
  })
  client.store.setState((state) => ({
    draftSessions: Object.fromEntries(Object.entries(state.draftSessions).filter(([key]) => key !== id)),
    sessionList: state.sessionList.some((thread) => thread.sessionId === id)
      ? state.sessionList
      : [
          { sessionId: id, cwd: current.cwd, title: text.slice(0, 40), archived: false, updatedAt: FIXED_TIME },
          ...state.sessionList
        ],
    runStates: { ...state.runStates, [id]: runState(id, "running") }
  }))
  actionsTaken.push({ type: "prompt", id, value: prompt })
  later(() => {
    if (client.state.sessions[id]?.state !== "running") return
    publish(
      applyUpdate(client.session(id), {
        sessionUpdate: "agent_thought_chunk",
        messageId: `${id}-thought-${index}`,
        content: { type: "text", text: "正在核对项目文件和交付清单。" }
      })
    )
  }, 300)
  later(() => {
    if (client.state.sessions[id]?.state !== "running") return
    if (response === "permission") {
      client.store.setState((state) => ({
        actions: [...state.actions, pendingAction("permission", id)],
        runStates: { ...state.runStates, [id]: { ...state.runStates[id], state: "requires_action" } }
      }))
    } else if (response === "question") publish({ ...makeSession("question", id), cwd: current.cwd })
    else if (response === "error") publish({ ...makeSession("error", id), cwd: current.cwd })
    else finish(id)
  }, 1300)
  return Promise.resolve(`${id}-user-${index}`)
}
client.cancel = async (id) => {
  publish({ ...client.session(id), state: "idle", lastStopReason: "cancelled" })
  client.store.setState((state) => ({
    actions: state.actions.filter((action) => action.sessionId !== id),
    runStates: { ...state.runStates, [id]: runState(id, "done") }
  }))
  actionsTaken.push({ type: "cancel", id })
  return Promise.resolve()
}
client.stopSession = async (id) => {
  await client.cancel(id)
  publish({ ...client.session(id), attached: false })
}
client.respond = (id, value) => {
  const action = client.state.actions.find((action) => action.id === id)
  actionsTaken.push({ type: "respond", id, value })
  client.store.setState((state) => ({ actions: state.actions.filter((action) => action.id !== id) }))
  if (action?.sessionId)
    finish(
      action.sessionId,
      JSON.stringify(value).includes("reject") || JSON.stringify(value).includes("cancel")
        ? "已取消本次操作，项目文件保持当前内容。"
        : "已收到确认，交付清单已更新。"
    )
}
client.setConfig = (id, configId, value) => {
  publish({
    ...client.session(id),
    configOptions: client
      .session(id)
      .configOptions.map((option) =>
        option.configId === configId ? ({ ...option, currentValue: value } as typeof option) : option
      )
  })
  return Promise.resolve()
}
client.renameSession = (id, title) => {
  if (client.state.sessions[id]) publish({ ...client.session(id), title })
  client.store.setState((state) => ({
    sessionList: state.sessionList.map((thread) => (thread.sessionId === id ? { ...thread, title } : thread))
  }))
  return Promise.resolve()
}
client.archive = (id) => {
  const thread = client.state.sessionList.find((thread) => thread.sessionId === id)
  client.store.setState((state) => ({
    sessionList: state.sessionList.filter((thread) => thread.sessionId !== id),
    archivedSessions: thread ? [{ ...thread, archived: true }, ...state.archivedSessions] : state.archivedSessions
  }))
  return Promise.resolve()
}
const unarchive: typeof client.unarchive = (id) => {
  const thread = client.state.archivedSessions.find((thread) => thread.sessionId === id)
  client.store.setState((state) => ({
    archivedSessions: state.archivedSessions.filter((thread) => thread.sessionId !== id),
    sessionList: thread ? [{ ...thread, archived: false }, ...state.sessionList] : state.sessionList
  }))
  return Promise.resolve()
}
const deleteSession: typeof client.delete = (id) => {
  client.store.setState((state) => ({
    sessionList: state.sessionList.filter((thread) => thread.sessionId !== id),
    archivedSessions: state.archivedSessions.filter((thread) => thread.sessionId !== id)
  }))
  actionsTaken.push({ type: "delete", id })
  return Promise.resolve()
}
export let forkScenario: "ready" | "pending" | "error" = "ready"
export function setForkScenario(value: typeof forkScenario): void {
  forkScenario = value
}
client.fork = (id, cwd, options) => {
  const turnId = typeof options === "string" ? options : options?.lastTurnId
  if (forkScenario === "pending") return new Promise(() => {})
  if (forkScenario === "error") return Promise.resolve("storybook-missing-fork")
  const next = `${id}-fork-${++sequence}`
  const source = client.session(id)
  const boundary = turnId
    ? source.items.findLastIndex((item) => codexTurnId(item._meta) === turnId)
    : source.items.length - 1
  const originTurnId =
    turnId ??
    source.items
      .slice(0, boundary + 1)
      .map((item) => codexTurnId(item._meta))
      .findLast((id) => id !== null) ??
    null
  if (boundary < 0) return Promise.reject(new Error("Fork turn is unavailable"))
  const title = forkTitle(
    source.title ?? "新聊天",
    [...client.state.sessionList, ...client.state.archivedSessions].flatMap((row) => (row.title ? [row.title] : []))
  )
  publish({
    ...source,
    items: source.items.slice(0, boundary + 1).map((item) => ({ ...item, replayed: true })),
    id: next,
    cwd,
    readOnly: false,
    attached: true,
    title
  })
  client.store.setState((state) => ({
    forkOrigins: { ...state.forkOrigins, [next]: { sourceId: id, boundaryTurnId: originTurnId } }
  }))
  client.includeSession({
    sessionId: next,
    cwd,
    title: client.session(next).title,
    updatedAt: FIXED_TIME,
    archived: false
  })
  return Promise.resolve(next)
}
client.loadOlderHistory = async () => {}
client.loadHistoryNavigation = async () => {}
client.previewHistoryTurn = async () => {}
client.loadHistoryTurn = async () => {}
client.retrySession = (id) => Promise.resolve(finish(id, "重试成功，页面检查已完成。"))
client.readAccount = () =>
  Promise.resolve({
    account: { type: "chatgpt", email: "lin.ran@example.test", planType: "plus", workspaceName: null },
    requiresOpenaiAuth: true,
    workspaceRouting: null
  })
client.readRateLimits = () =>
  Promise.resolve({
    limitId: null,
    limitName: null,
    primary: { usedPercent: 36, windowDurationMins: 300, resetsAt: 1792731600 },
    secondary: { usedPercent: 18, windowDurationMins: 10080, resetsAt: 1793163600 },
    credits: null,
    planType: "plus",
    spendControlReached: false,
    normalModelSlug: null,
    individualLimit: null,
    rateLimitReachedType: null
  })
client.listSkills = () => Promise.resolve({ data: [] })
client.fuzzyFileSearch = () => Promise.resolve({ files: [] })
client.login = async () => {}
client.logout = async () => {}
export function useApp<T>(selector: (state: AppState) => T): T {
  return useStore(client.store, selector)
}
export function useSession(id: string | null): Session | null {
  return useApp((state) => (id === null ? null : (state.sessions[id] ?? null)))
}
export function markRead(id: string): Promise<void> {
  actionsTaken.push({ type: "markRead", id })
  return Promise.resolve()
}
export async function stopSession(id: string): Promise<void> {
  await client.stopSession(id)
}
export function watchRunStates(): Promise<() => void> {
  return Promise.resolve(() => {})
}

client.unarchive = unarchive
client.delete = deleteSession
