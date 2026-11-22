import { configureVibemon, type VibemonHost, type VibemonObservation } from "@alwith/module-auth/vibemon/core"
import { VibemonQuickReply } from "@alwith/module-auth/vibemon/react"
import { CodexClient, runStateSource } from "@alwith/module-chat/client"
import { emitTo, listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { createRoot } from "react-dom/client"

import { createFakeAgent } from "@alwith/module-chat/testing"
import { FakeHubPort } from "@alwith/module-chat/testing"
import { createVibemonSessionOwner } from "@/features/vibemon/session-host"
import { createVibemonWindowClient, vibemonWindowCall } from "@/features/vibemon/window-client"
import { initI18n } from "@/lib/i18n"
import { observeWindowHidden } from "@/lib/window-hidden"

const window = getCurrentWebviewWindow()
const root = document.getElementById("root")
if (root === null) throw new Error("Vibémon test root unavailable")
const publish = "vibemon-test:observation"
const answer = "vibemon-test:answer"
const begin = "vibemon-test:begin"
const surface = "vibemon-test:surface"

if (window.label === "main") {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "fake" } })
  await client.connect()
  const sessionId = await client.newSession("/tmp")
  client.applyRunStates(
    [
      {
        sessionId,
        state: "idle",
        since: 0,
        owner: "permission-fixture",
        title: "Permission fixture",
        cwd: "/tmp",
        executionId: null,
        executionRole: null,
        reusableDraft: false,
        tasks: [],
        listeningPorts: [],
        lastActivityAt: 0,
        version: 1,
        interruption: null
      }
    ],
    "snapshot"
  )
  const owner = createVibemonSessionOwner({
    state: () => client.state,
    source: () => runStateSource(client.state.runStates),
    agentId: "codex",
    agentForSession: () => Promise.resolve("codex"),
    claim: () => Promise.resolve(true),
    prompt: async (id, content) => {
      await client.prompt(id, content)
    },
    cancel: (id) => client.cancel(id),
    markRead: () => Promise.resolve(),
    respond: (token, response) => client.respond(token, response),
    openChat: () => Promise.reject(new Error("Unexpected chat navigation"))
  })
  owner.subscribe((value) => {
    const feed = value?.taskFeed
    root.dataset.pending = String(feed?.tasks.some((task) => task.prompt !== null) ?? false)
    for (const label of ["vibemon", "bubble-menu-vibemon"]) void emitTo(label, publish, feed ?? null)
  })
  client.store.subscribe(() => void owner.refresh())
  await owner.surface("main", { sessionId, visible: true })
  await listen<{ label: "main" | "chat"; visible: boolean }>(surface, ({ payload }) => {
    void owner.surface(payload.label, { sessionId, visible: payload.visible }).catch(console.error)
  })
  const observer = await observeWindowHidden(
    window,
    async (hidden) => {
      root.dataset.hidden = String(hidden)
      await owner.windowHidden("main", hidden)
    },
    console.error
  )
  await listen<{ binding: VibemonObservation["binding"]; token: string; optionId: string }>(answer, ({ payload }) => {
    void observer
      .refresh()
      .then(() => owner.answer(payload.binding, crypto.randomUUID(), payload.token, payload.optionId))
      .catch(console.error)
  })
  await listen(begin, () => {
    delete root.dataset.result
    void fake
      .requestPermission({
        sessionId,
        title: "Run command?",
        description: "Test permission request",
        options: [
          { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
          { optionId: "decline", name: "Decline", kind: "reject_once" }
        ]
      })
      .then((response) => {
        root.dataset.result = JSON.stringify(response)
      })
      .catch(console.error)
  })
} else if (window.label === "vibemon") {
  await listen<VibemonObservation["taskFeed"]>(publish, ({ payload }) => {
    const visible = payload?.tasks.some((task) => !task.surfaceVisible && task.prompt?.kind === "permission") ?? false
    void vibemonWindowCall("bubble", { visible })
  })
  await vibemonWindowCall("present")
} else if (window.label === "bubble-menu-vibemon") {
  let value: VibemonObservation | null = null
  const listeners = new Set<(value: VibemonObservation | null) => void>()
  await initI18n("en")
  await listen<VibemonObservation["taskFeed"]>(publish, ({ payload }) => {
    value = payload?.tasks[0] ? { ...payload.tasks[0], taskFeed: payload } : null
    for (const listener of listeners) listener(value)
  })
  configureVibemon({
    account: () => ({ apiHost: "test", userId: "test", revision: 1 }),
    assets: {} as VibemonHost["assets"],
    storage: { get: async () => undefined, set: async () => {} },
    subscribeStorage: () => () => {},
    sessions: {
      snapshot: () => value,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      answer: (binding, _, token, optionId) => emitTo("main", answer, { binding, token, optionId }),
      panel: async () => {},
      send: async () => {},
      cancel: async () => {},
      openChat: async () => {},
      activate: async () => {},
      select: async () => {}
    },
    windows: createVibemonWindowClient(),
    onError: (error) => {
      root.dataset.error = String(error)
    }
  })
  createRoot(root).render(<VibemonQuickReply />)
} else {
  throw new Error("Unexpected Vibémon test window")
}
root.dataset.ready = "true"
