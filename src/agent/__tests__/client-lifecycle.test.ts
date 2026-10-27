import { expect, test } from "vitest"

import { CodexClient } from "../client"
import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

test("close during tool preparation retires the prompt without waiting on a nested replay", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const entered = Promise.withResolvers<void>()
  const preparation = Promise.withResolvers<void>()
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: { engine: "codex" },
    prepareSessionTools: () => {
      entered.resolve()
      return preparation.promise
    }
  })
  try {
    await client.connect()
    const id = await client.newSession("/tmp/preparation-close")
    const sending = client.prompt(id, [{ type: "text", text: "must not send" }]).catch((error: unknown) => error)
    await entered.promise
    const closing = client.close(id)
    preparation.reject(new Error("tool refresh failed"))
    expect(await sending).toMatchObject({ name: "AbortError" })
    await closing
    expect(client.state.sessions[id]).toBeUndefined()
  } finally {
    client.disconnect()
  }
})
