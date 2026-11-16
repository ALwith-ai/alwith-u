import { CodexClient, isSelectOption } from "@alwith/module-chat/client"
import { afterEach, expect, test } from "vitest"

import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

const clients: CodexClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect()
})

async function fixture() {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: { engine: "codex" }
  })
  clients.push(client)
  await client.connect()
  return { client, fake }
}

function selectedModel(client: CodexClient, id: string): string {
  const option = client.session(id).configOptions.find((value) => value.category === "model")
  if (!option || !isSelectOption(option)) throw new Error("The session has no model selection")
  return option.currentValue
}

test("a first draft uses the agent default when neither chat surface has a saved model", async () => {
  const { client, fake } = await fixture()
  client.setModelSelections({ main: null, chat: null })
  for (const owner of ["main", "chat"] as const) {
    const id = await client.prepareDraft(owner, `/tmp/${owner}`)
    expect(fake.modelHints.get(id)).toBeNull()
    expect(selectedModel(client, id)).toBe("gpt-6.1-sol")
  }
})

test("new drafts inherit each surface's saved choice independently after discarding their predecessors", async () => {
  const { client, fake } = await fixture()
  client.setModelSelections({ main: "main-model", chat: "chat-model" })
  for (const owner of ["main", "chat"] as const) {
    const first = await client.prepareDraft(owner, `/tmp/${owner}`)
    await client.discardDraft(owner)
    const next = await client.prepareDraft(owner, `/tmp/${owner}-next`)
    expect(next).not.toBe(first)
    expect(fake.modelHints.get(next)).toBe(`${owner}-model`)
    expect(selectedModel(client, next)).toBe(`${owner}-model`)
  }
})

test("viewing a historical model does not replace a confirmed choice for the next new chat", async () => {
  const { client, fake } = await fixture()
  client.setModelSelections({ main: null, chat: "chat-model" })
  const first = await client.prepareDraft("main", "/tmp/main")
  const confirmed: Array<[string, string]> = []
  client.onConfirmedModel((owner, model) => confirmed.push([owner, model]))
  await client.setConfig(first, "model", "picked", "main")
  await client.discardDraft("main")
  fake.persistedModels.set("historical", "another-model")
  await client.open("historical", "/tmp/history", "main")
  expect(selectedModel(client, "historical")).toBe("another-model")
  const next = await client.prepareDraft("main", "/tmp/new")
  expect(selectedModel(client, next)).toBe("picked")
  expect(fake.modelHints.get(next)).toBe("picked")
  expect(confirmed).toEqual([["main", "picked"]])
  const floating = await client.prepareDraft("chat", "/tmp/chat")
  expect(selectedModel(client, floating)).toBe("chat-model")
})

test("a rejected model change does not become the next chat's remembered model", async () => {
  const { client, fake } = await fixture()
  client.setModelSelections({ main: "main-model", chat: null })
  const first = await client.prepareDraft("main", "/tmp/main")
  fake.configResponse.current = () => {
    throw new Error("Rejected model change")
  }
  await expect(client.setConfig(first, "model", "broken-model", "main")).rejects.toThrow()
  fake.configResponse.current = null
  await client.discardDraft("main")
  const next = await client.prepareDraft("main", "/tmp/next")
  expect(selectedModel(client, next)).toBe("main-model")
})
