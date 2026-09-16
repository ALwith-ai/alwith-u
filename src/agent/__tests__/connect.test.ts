import { afterEach, expect, test } from "bun:test"
import { CodexClient } from "../client"
import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

const clients: CodexClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect()
})

async function until(predicate: () => boolean) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > 3000) throw new Error("Timed out")
    await Bun.sleep(5)
  }
}

test("a fresh Runtime starts the agent and the client talks ACP through it", async () => {
  const port = new FakeHubPort(() => createFakeAgent().app)
  const client = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  clients.push(client)
  await client.connect()
  expect(port.started).toEqual(["codex"])
  expect(client.state.agent?.info.name).toBe("fake-codex")
  const id = await client.newSession("/tmp/a")
  await client.prompt(id, [{ type: "text", text: "hello" }])
  await until(() => client.session(id).state === "idle")
  const reply = client.session(id).items.find(item => item.kind === "assistant")
  expect(reply?.kind === "assistant" && reply.content[0]?.type === "text" ? reply.content[0].text : "").toBe(
    `reply:${id}`
  )
})

test("a Runtime that already runs the agent is attached, not restarted, and pending permissions replay", async () => {
  const port = new FakeHubPort(() => createFakeAgent().app)
  // Boot once so the fake Runtime has a live agent, exactly as after a webview reload.
  await port.start("codex", { engine: "codex" })
  const permission = {
    id: 41,
    method: "session/request_permission",
    params: { sessionId: "s-old", title: "Run command?", options: [{ optionId: "allow_once", name: "Allow once", kind: "allow_once" }] }
  }
  port.seedRunningSession("s-old", "codex", [permission])
  // Another app's agent on the same Runtime: never attached (attach claims it; releasing it
  // afterwards would leave it ownerless).
  port.seedRunningSession("s-theirs", "desktop-chat1", [])

  const client = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  clients.push(client)
  await client.connect()
  // Attached, not restarted: one start ever, and the initialize response came from the Runtime.
  expect(port.started).toEqual(["codex"])
  expect(port.attached).toEqual(["s-old"])
  expect(client.state.connection).toBe("ready")
  expect(client.state.agent?.info.name).toBe("fake-codex")
  await until(() => client.state.actions.length === 1)
  const action = client.state.actions[0]!
  expect(action.kind).toBe("permission")
  expect(action.sessionId).toBe("s-old")
})
