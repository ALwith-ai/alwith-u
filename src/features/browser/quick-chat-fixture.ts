/** Browser-fixture-only in-process chat double. It never starts Runtime or uses account credentials. */
import { createSession, type MessageItem } from "@alwith/module-chat/client"

import { client } from "@/lib/client"

export function installQuickChatFixture({
  cwd = "/tmp/browser-chat-fixture",
  reply = "浏览器聊天已连接。"
}: { cwd?: string; reply?: string } = {}) {
  client.session = (id) => {
    const session = client.state.sessions[id]
    if (!session) throw Error(`Unknown fixture conversation ${id}`)
    return session
  }
  client.holds = (id) => client.state.sessions[id] !== undefined
  client.connect = async () => {
    client.store.setState({ connection: "ready" })
  }
  client.refreshProjectContext = async () => ({
    homeDirectory: cwd,
    codexChatDirectory: cwd,
    chatDirectory: cwd,
    projects: []
  })
  client.newSession = async () => {
    const id = `browser-fixture-${crypto.randomUUID()}`
    const session = { ...createSession(id, cwd), attached: true }
    client.store.setState((state) => ({ sessions: { ...state.sessions, [id]: session } }))
    return id
  }
  client.open = async (id) => {
    if (!client.state.sessions[id]) throw Error("Unknown fixture conversation")
  }
  client.readInputConfig = async (sessionId) => ({ sessionId, revision: 0, inputConfig: null })
  client.readRateLimits = async () => ({
    limitId: null,
    limitName: null,
    primary: null,
    secondary: null,
    credits: null,
    planType: null,
    spendControlReached: false,
    normalModelSlug: null,
    individualLimit: null,
    rateLimitReachedType: null
  })
  client.installedApps = async () => ({ apps: [] })
  client.loadHistoryNavigation = async () => {}
  client.stopSession = async (id) => {
    client.store.setState((state) => {
      const session = state.sessions[id]
      const runStates = { ...state.runStates }
      delete runStates[id]
      return {
        runStates,
        sessions: { ...state.sessions, ...(session ? { [id]: { ...session, attached: false } } : {}) }
      }
    })
  }
  client.prompt = async (id, content) => {
    const session = client.session(id)
    const messages: MessageItem[] = [
      { id: crypto.randomUUID(), kind: "user", content, at: 0, replayed: false, _meta: null, echo: null },
      {
        id: crypto.randomUUID(),
        kind: "assistant",
        content: [{ type: "text", text: reply }],
        at: 0,
        replayed: false,
        _meta: null,
        echo: null
      }
    ]
    client.store.setState((state) => ({
      sessions: { ...state.sessions, [id]: { ...session, items: [...session.items, ...messages] } }
    }))
    return crypto.randomUUID()
  }
}
