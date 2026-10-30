import type { Session, SessionRunState } from "@alwith/api"
import { applyUpdate, createSession, isSelectOption, isText } from "@alwith/api"
import { useStore } from "zustand"

import { type AppState, CodexClient } from "../../src/agent/client"
import {
  assistantMessage,
  configOptions,
  FIXED_TIME,
  makeSession,
  makeThreads,
  pendingAction,
  userMessage
} from "./catalog"

// Only the UI projection is used. No preview can acquire a native Runtime connection.
export const client = new CodexClient(
  async () => {
    throw new Error("Native Runtime is disabled in Storybook")
  },
  {
    agentId: "storybook",
    launch: { engine: "storybook" }
  }
)
const initialState = client.state
let connectionCase = "ready"
let connectAttempts = 0
let sequence = 0
let response: "complete" | "permission" | "question" | "error" = "complete"
let draftFailure: string | null = null
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
  options: { connection?: string; response?: typeof response; draftFailure?: string | null } = {}
): void {
  client.unarchive = unarchive
  client.delete = deleteSession
  for (const timer of timers) clearTimeout(timer)
  timers = []
  connectionCase = options.connection ?? "ready"
  connectAttempts = 0
  sequence = 0
  response = options.response ?? "complete"
  draftFailure = options.draftFailure ?? null
  client.listThreads = async () => {}
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
      threads,
      threadsLoaded: true,
      archivedLoaded: true,
      archivedThreads: threads
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
              forkAtTurn: true
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
client.disconnect = async () => {}
client.connect = async () => {
  if (connectionCase === "connecting") return new Promise(() => {})
  if (["failed", "disconnected"].includes(connectionCase) && ++connectAttempts === 1)
    throw new Error("模拟连接中断，请重试。")
  client.store.setState({ connection: "ready", connectionError: null })
}
client.listThreads = async () => {}
client.listProjectThreads = async (cwd) => client.state.threads.filter((thread) => thread.cwd === cwd)
client.listHistorySessions = async () => [...client.state.threads, ...client.state.archivedThreads]
client.readThreadSummary = async (id) => client.state.threads.find((thread) => thread.sessionId === id) ?? null
client.activityReply = async () => "页面与交互检查已完成，交付资料已经更新。"
client.prepareDraft = async (owner, cwd, model) => {
  if (draftFailure) throw Object.assign(new Error(draftFailure), { code: -32000 })
  const previous = Object.keys(client.state.draftSessions).find(
    (id) =>
      client.state.draftSessions[id] === owner &&
      client.state.sessions[id]?.cwd === cwd &&
      (!model ||
        client.state.sessions[id]?.configOptions.some(
          (option) => option.category === "model" && option.currentValue === model
        ))
  )
  if (previous) return previous
  const id = `draft-${owner}-${++sequence}`
  const session = {
    ...createSession(id, cwd),
    attached: true,
    configOptions: configOptions.map((option) =>
      isSelectOption(option) && option.category === "model" && model
        ? ({ ...option, currentValue: model } as typeof option)
        : option
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
  return id
}
client.discardDraft = async (owner) => {
  client.store.setState((state) => ({
    draftSessions: Object.fromEntries(Object.entries(state.draftSessions).filter(([, current]) => current !== owner))
  }))
}
client.transferDraft = async (id, owner) => {
  if (!(id in client.state.draftSessions)) return
  client.store.setState((state) => ({
    draftSessions: {
      ...Object.fromEntries(Object.entries(state.draftSessions).filter(([, value]) => value !== owner)),
      [id]: owner
    }
  }))
}
client.newSession = async (cwd, model, owner = "main") => client.prepareDraft(owner, cwd, model)
client.open = async (id, cwd) => {
  publish({ ...(client.state.sessions[id] ?? makeSession("conversation", id)), cwd, attached: true, restoring: false })
}
client.prompt = async (id, prompt) => {
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
    threads: state.threads.some((thread) => thread.sessionId === id)
      ? state.threads
      : [
          { sessionId: id, cwd: current.cwd, title: text.slice(0, 40), archived: false, updatedAt: FIXED_TIME },
          ...state.threads
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
        runStates: { ...state.runStates, [id]: { ...state.runStates[id]!, state: "requires_action" } }
      }))
    } else if (response === "question") publish({ ...makeSession("question", id), cwd: current.cwd })
    else if (response === "error") publish({ ...makeSession("error", id), cwd: current.cwd })
    else finish(id)
  }, 1300)
}
client.promptReceipt = async (id, prompt) => {
  await client.prompt(id, prompt)
  return `receipt-${sequence}`
}
client.cancel = async (id) => {
  publish({ ...client.session(id), state: "idle" })
  client.store.setState((state) => ({
    actions: state.actions.filter((action) => action.sessionId !== id),
    runStates: { ...state.runStates, [id]: runState(id, "done") }
  }))
  actionsTaken.push({ type: "cancel", id })
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
client.setConfig = async (id, configId, value) => {
  publish({
    ...client.session(id),
    configOptions: client
      .session(id)
      .configOptions.map((option) =>
        option.configId === configId ? ({ ...option, currentValue: value } as typeof option) : option
      )
  })
}
client.renameSession = async (id, title) => {
  if (client.state.sessions[id]) publish({ ...client.session(id), title })
  client.store.setState((state) => ({
    threads: state.threads.map((thread) => (thread.sessionId === id ? { ...thread, title } : thread))
  }))
}
client.archive = async (id) => {
  const thread = client.state.threads.find((thread) => thread.sessionId === id)
  client.store.setState((state) => ({
    threads: state.threads.filter((thread) => thread.sessionId !== id),
    archivedThreads: thread ? [{ ...thread, archived: true }, ...state.archivedThreads] : state.archivedThreads
  }))
}
const unarchive: typeof client.unarchive = async (id) => {
  const thread = client.state.archivedThreads.find((thread) => thread.sessionId === id)
  client.store.setState((state) => ({
    archivedThreads: state.archivedThreads.filter((thread) => thread.sessionId !== id),
    threads: thread ? [{ ...thread, archived: false }, ...state.threads] : state.threads
  }))
}
const deleteSession: typeof client.delete = async (id) => {
  client.store.setState((state) => ({
    threads: state.threads.filter((thread) => thread.sessionId !== id),
    archivedThreads: state.archivedThreads.filter((thread) => thread.sessionId !== id)
  }))
  actionsTaken.push({ type: "delete", id })
}
client.fork = async (id, cwd) => {
  const next = `${id}-fork-${++sequence}`
  publish({
    ...client.session(id),
    id: next,
    cwd,
    readOnly: false,
    attached: true,
    title: `${client.session(id).title} · 分支`
  })
  client.includeThread({
    sessionId: next,
    cwd,
    title: client.session(next).title,
    updatedAt: FIXED_TIME,
    archived: false
  })
  return next
}
client.loadOlderHistory = async () => {}
client.loadHistoryNavigation = async () => {}
client.previewHistoryTurn = async () => {}
client.loadHistoryTurn = async () => {}
client.requestPrediction = async () => {}
client.retrySession = async (id) => finish(id, "重试成功，页面检查已完成。")
client.readAccount = async () => ({
  account: { type: "chatgpt", email: "lin.ran@example.test", planType: "plus" },
  requiresOpenaiAuth: true
})
client.readRateLimits = async () => ({
  limitId: null,
  limitName: null,
  primary: { usedPercent: 36, windowDurationMins: 300, resetsAt: 1792731600 },
  secondary: { usedPercent: 18, windowDurationMins: 10080, resetsAt: 1793163600 },
  credits: null,
  planType: "plus",
  spendControlReached: false
})
client.listSkills = async () => ({ data: [] })
client.fuzzyFileSearch = async () => ({ files: [] })
client.login = async () => {}
client.logout = async () => {}
export function useApp<T>(selector: (state: AppState) => T): T {
  return useStore(client.store, selector)
}
export function useSession(id: string | null): Session | null {
  return useApp((state) => (id === null ? null : (state.sessions[id] ?? null)))
}
export async function markRead(id: string): Promise<void> {
  actionsTaken.push({ type: "markRead", id })
}
export async function stopSession(id: string): Promise<void> {
  await client.stopSession(id)
}
export async function watchRunStates(): Promise<() => void> {
  return () => {}
}

client.unarchive = unarchive
client.delete = deleteSession
