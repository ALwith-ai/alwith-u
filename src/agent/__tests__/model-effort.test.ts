import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { afterEach, expect, test, vi } from "vitest"

import { CodexClient } from "../client"
import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

const glm = "gateway:custom-test:glm-5.3"
const kimi = "gateway:custom-test:kimi-k3"
const clients: CodexClient[] = []
afterEach(() => clients.splice(0).forEach((client) => client.disconnect()))

function options(model: string, effort: string): acp.SessionConfigOption[] {
  return [
    {
      configId: "model",
      category: "model",
      name: "Model",
      type: "select",
      currentValue: model,
      options: [
        { value: glm, name: "GLM" },
        { value: kimi, name: "Kimi" },
        { value: "gpt-6.1-sol", name: "Native" }
      ]
    },
    {
      configId: "reasoning_effort",
      category: "thought_level",
      name: "Effort",
      type: "select",
      currentValue: effort,
      options: ["low", "high", "max"].map((value) => ({ value, name: value }))
    }
  ]
}

async function make(initial: string) {
  const fake = createFakeAgent()
  let current = options(glm, initial)
  const writes: acp.SetSessionConfigOptionRequest[] = []
  fake.sessionOptions.current = (model) => {
    current = options(model ?? glm, initial)
    return current
  }
  fake.configResponse.current = (request) => {
    writes.push(request)
    current = current.map((option) =>
      option.configId === request.configId
        ? ({
            ...option,
            currentValue: request.value
          } as acp.SessionConfigOption)
        : option
    )
    return { configOptions: current }
  }
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: { engine: "codex" }
  })
  clients.push(client)
  await client.connect()
  return { client, fake, writes, port }
}

function effort(client: CodexClient, id: string): unknown {
  return client.session(id).configOptions.find((option) => option.category === "thought_level")?.currentValue
}

test.each(["medium", "low"])("new custom sessions use the model default instead of inherited %s", async (inherited) => {
  const { client } = await make(inherited)
  const id = await client.newSession("/tmp/effort", glm)
  expect(effort(client, id)).toBe("max")
})

test("model switching resets even a supported effort to the target default", async () => {
  const { client } = await make("max")
  const id = await client.newSession("/tmp/effort", kimi)
  await client.setConfig(id, "reasoning_effort", "low")
  await client.setConfig(id, "model", glm)
  expect(effort(client, id)).toBe("max")
})

test("draft model switching does not copy the previous model's effort", async () => {
  const { client } = await make("max")
  const first = await client.prepareDraft("main", "/tmp/effort", kimi)
  await client.setConfig(first, "reasoning_effort", "low")
  const next = await client.prepareDraft("main", "/tmp/effort", glm)
  expect(effort(client, next)).toBe("max")
})

test.each(["medium", "low"])("resume repairs invalid effort but preserves supported %s", async (saved) => {
  const { client, fake } = await make("max")
  const id = await client.newSession("/tmp/effort", glm)
  await client.stopSession(id)
  fake.resumeResponse.current = async () => ({
    configOptions: options(glm, saved)
  })
  await client.open(id, "/tmp/effort")
  expect(effort(client, id)).toBe(saved === "medium" ? "max" : saved)
})

test("resume repairs inherited medium using the current valid selection", async () => {
  const { client, fake } = await make("max")
  const id = await client.newSession("/tmp/effort", glm)
  await client.setConfig(id, "reasoning_effort", "low")
  await client.stopSession(id)
  fake.resumeResponse.current = async () => ({ configOptions: options(glm, "medium") })
  await client.open(id, "/tmp/effort")
  expect(effort(client, id)).toBe("low")
})

test("the prompt waits for the target default and rejects if applying it fails", async () => {
  const { client, fake } = await make("max")
  const id = await client.newSession("/tmp/effort", kimi)
  await client.setConfig(id, "reasoning_effort", "low")
  const respond = fake.configResponse.current!
  fake.configResponse.current = (request) => {
    if (request.configId === "reasoning_effort") throw new Error("effort unavailable")
    return respond(request)
  }
  const change = client.setConfig(id, "model", glm)
  const prompt = client.prompt(id, [{ type: "text", text: "must not send" }])
  const result = await Promise.allSettled([change, prompt])
  expect(result.map((entry) => entry.status)).toEqual(["rejected", "rejected"])
  expect(client.session(id).items).toEqual([])
  await vi.waitFor(() => expect(client.state.configPending[id]).toBeUndefined())
})

test("a prompt repairs an invalid effort received after attachment", async () => {
  const { client, fake } = await make("max")
  const id = await client.newSession("/tmp/effort", glm)
  await fake.pushUpdate(id, {
    sessionUpdate: "config_option_update",
    configOptions: options(glm, "medium")
  })
  await vi.waitFor(() => expect(effort(client, id)).toBe("medium"))
  await client.prompt(id, [{ type: "text", text: "hello" }])
  expect(effort(client, id)).toBe("max")
})

test("cancelling a pending effort repair prevents the prompt from sending", async () => {
  const { client, fake } = await make("max")
  const id = await client.newSession("/tmp/effort", glm)
  await fake.pushUpdate(id, { sessionUpdate: "config_option_update", configOptions: options(glm, "medium") })
  await vi.waitFor(() => expect(effort(client, id)).toBe("medium"))
  let release: (() => void) | undefined
  fake.configDelay.current = () =>
    new Promise<void>((resolve) => {
      release = resolve
    })
  const pending = Promise.allSettled([client.prompt(id, [{ type: "text", text: "must not send" }])])
  await vi.waitFor(() => expect(release).toBeDefined())
  await client.cancel(id)
  release!()
  expect((await pending)[0].status).toBe("rejected")
  expect(client.session(id).items).toEqual([])
})

test("unrecognized custom models keep their agent-owned effort", async () => {
  const { client, writes } = await make("low")
  const id = await client.newSession("/tmp/effort", "gateway:custom-test:unknown-model")
  expect(effort(client, id)).toBe("low")
  expect(writes).toEqual([])
})

test("models without graded efforts reset their transport default without exposing a selector", async () => {
  const { client, fake, writes } = await make("max")
  const model = "gateway:custom-test:glm-5.1"
  fake.sessionOptions.current = () => options(model, "medium").filter((option) => option.category === "model")
  fake.configResponse.current = (request) => {
    writes.push(request)
    return {
      configOptions: options(model, "medium").filter((option) => option.category === "model")
    }
  }
  const id = await client.newSession("/tmp/effort", model)
  expect(effort(client, id)).toBeUndefined()
  expect(
    writes.map((request) => ({
      configId: request.configId,
      value: request.value
    }))
  ).toEqual([{ configId: "model", value: model }])
})

test.each(["model", "reasoning_effort"])(
  "a failed old effort repair does not block an explicit %s change",
  async (configId) => {
    const { client, fake } = await make("max")
    const id = await client.newSession("/tmp/effort", glm)
    await fake.pushUpdate(id, { sessionUpdate: "config_option_update", configOptions: options(glm, "medium") })
    await vi.waitFor(() => expect(effort(client, id)).toBe("medium"))
    const respond = fake.configResponse.current!
    fake.configResponse.current = (request) => {
      if (request.configId === "reasoning_effort" && request.value === "max")
        throw new Error("old effort repair failed")
      return respond(request)
    }
    const value = configId === "model" ? "gpt-6.1-sol" : "low"
    await client.setConfig(id, configId, value)
    expect(client.session(id).configOptions.find((option) => option.configId === configId)?.currentValue).toBe(value)
  }
)

test.each(["prompt", "config"])("%s waits for effort repair during replay", async (operation) => {
  const { client, fake, port } = await make("max")
  const id = await client.newSession("/tmp/effort", glm)
  await client.stopSession(id)
  fake.resumeResponse.current = async () => ({ configOptions: options(glm, "medium") })
  let release: (() => void) | undefined
  let calls = 0
  fake.configDelay.current = () =>
    ++calls === 1
      ? new Promise<void>((resolve) => {
          release = resolve
        })
      : Promise.resolve()
  const opening = client.open(id, "/tmp/effort")
  await vi.waitFor(() => expect(release).toBeDefined())
  const sending = vi.spyOn(port, "prompt")
  const pending =
    operation === "prompt"
      ? client.prompt(id, [{ type: "text", text: "hello" }])
      : client.setConfig(id, "reasoning_effort", "low")
  const settled = Promise.allSettled([pending])
  await new Promise((resolve) => setTimeout(resolve, 25))
  const concurrent = operation === "prompt" ? sending.mock.calls.length : calls - 1
  release!()
  await opening
  expect((await settled)[0].status).toBe("fulfilled")
  expect(concurrent).toBe(0)
  expect(effort(client, id)).toBe(operation === "prompt" ? "max" : "low")
})

test("failed hidden effort repair leaves replay detached and retryable", async () => {
  const { client, fake } = await make("max")
  const model = "gateway:custom-test:glm-5.1"
  const hidden = () => options(model, "medium").filter((option) => option.category === "model")
  fake.sessionOptions.current = hidden
  fake.configResponse.current = () => ({ configOptions: hidden() })
  const id = await client.newSession("/tmp/effort", model)
  await client.stopSession(id)
  fake.resumeResponse.current = async () => ({ configOptions: hidden() })
  fake.configResponse.current = () => {
    throw new Error("hidden effort repair failed")
  }
  await expect(client.open(id, "/tmp/effort")).rejects.toThrow()
  expect(client.session(id).attached).toBe(false)
  fake.configResponse.current = () => ({ configOptions: hidden() })
  await client.open(id, "/tmp/effort")
  expect(client.session(id).attached).toBe(true)
})

test("concurrent opens share the effort repair as well as the resume request", async () => {
  const { client, fake } = await make("max")
  const id = await client.newSession("/tmp/effort", glm)
  await client.stopSession(id)
  let finishResume!: () => void
  const resumeGate = new Promise<void>((resolve) => {
    finishResume = resolve
  })
  let resumeCalls = 0
  fake.resumeResponse.current = async () => {
    resumeCalls++
    await resumeGate
    return { configOptions: options(glm, "medium") }
  }
  let finishRepair: (() => void) | undefined
  let repairCalls = 0
  fake.configDelay.current = () =>
    ++repairCalls === 1
      ? new Promise<void>((resolve) => {
          finishRepair = resolve
        })
      : Promise.resolve()
  const first = client.open(id, "/tmp/effort")
  await vi.waitFor(() => expect(resumeCalls).toBe(1))
  const second = client.open(id, "/tmp/effort")
  const settled = Promise.allSettled([first, second])
  finishResume()
  await vi.waitFor(() => expect(finishRepair).toBeDefined())
  await new Promise((resolve) => setTimeout(resolve, 25))
  finishRepair!()
  expect((await settled).map((result) => result.status)).toEqual(["fulfilled", "fulfilled"])
  expect(repairCalls).toBe(1)
  await client.setConfig(id, "reasoning_effort", "low")
  expect(effort(client, id)).toBe("low")
})
