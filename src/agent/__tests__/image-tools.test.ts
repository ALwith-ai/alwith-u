import type { ImageSelection } from "@alwith/module-chat/image"
import { expect, test, vi } from "vitest"

import { chatHistoryState } from "@/lib/chat-history"

import { CodexClient } from "../client"
import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

function fixture() {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const selection: { current: ImageSelection } = { current: { model: "doubao-seedream-4-5-251128", size: "2K" } }
  const generateExternal = vi.fn(
    async (_selection: ImageSelection, _prompt: string, _images: string[], _signal?: AbortSignal) => ({
      images: [{ mimeType: "image/png", data: "aGVsbG8=" }]
    })
  )
  const client = new CodexClient(async () => port, {
    agentId: "codex",
    launch: { engine: "codex" },
    imageService: { selection: () => selection.current, generateExternal }
  })
  return { fake, port, selection, generateExternal, client }
}

test("gallery creations mark their native source and forks retain it without marking ordinary chats", async () => {
  const { port, client } = fixture()
  const request = vi.spyOn(port, "acpRequest")
  try {
    await client.connect()
    const id = await client.newImageSession("/tmp")
    const creation = request.mock.calls.find((call) => call[1] === "session/new")?.[2]
    expect(creation).toMatchObject({ _meta: { codex: { threadSource: "alwith-images" } } })
    client.store.setState((state) => ({
      sessionList: state.sessionList.map((row) =>
        row.sessionId === id ? { ...row, threadSource: "alwith-images" } : row
      )
    }))
    await client.fork(id, "/tmp")
    const fork = request.mock.calls.find((call) => call[1] === "session/fork")?.[2]
    expect(fork).toMatchObject({ _meta: { codex: { threadSource: "alwith-images" } } })
    await client.newSession("/tmp")
    const ordinary = request.mock.calls.findLast((call) => call[1] === "session/new")?.[2]
    expect(ordinary).not.toHaveProperty("_meta.codex.threadSource")
  } finally {
    client.disconnect()
  }
})

test("an image draft exposes inherited model settings without replacing or entering the main draft index", async () => {
  const { fake, client } = fixture()
  try {
    const settings = (
      effort: string,
      mode = "agent"
    ): import("@alwith/module-chat/client").Session["configOptions"] => [
      {
        configId: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "gpt-6.1-sol",
        options: [{ value: "gpt-6.1-sol", name: "GPT-6.1 Sol" }]
      },
      {
        configId: "reasoning_effort",
        name: "Effort",
        category: "thought_level",
        type: "select",
        currentValue: effort,
        options: [
          { value: "low", name: "Low" },
          { value: "high", name: "High" }
        ]
      },
      { configId: "fast-mode", name: "Fast", category: "model_config", type: "boolean", currentValue: false },
      {
        configId: "collaboration_mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: mode,
        options: [
          { value: "agent", name: "Agent" },
          { value: "plan", name: "Plan" }
        ]
      }
    ]
    fake.sessionOptions.current = () => settings("high", "plan")
    await client.connect()
    const main = await client.prepareDraft("main", "/tmp")
    fake.sessionOptions.current = () => settings("low")
    fake.configResponse.current = (request) => ({ configOptions: settings(String(request.value)) })
    const image = await client.newImageSession("/tmp", { draft: true, from: main })
    expect(client.state.drafts[image]).toBe(true)
    expect(client.state.draftSessions).toEqual({ [main]: "main" })
    expect(client.session(image).configOptions.find((option) => option.category === "model")?.currentValue).toBe(
      "gpt-6.1-sol"
    )
    expect(
      client.session(image).configOptions.find((option) => option.category === "thought_level")?.currentValue
    ).toBe("high")
    expect(client.session(image).configOptions.find((option) => option.category === "mode")?.currentValue).toBe("agent")
    fake.listSessions.current = () => ({ sessions: [{ sessionId: image, cwd: "/tmp" }] })
    await client.listSessions({ reset: true })
    expect(client.state.sessionList).toEqual([])
    await client.discardDraft(image)
    expect(fake.deleted.has(image)).toBe(true)
    expect(fake.deleted.has(main)).toBe(false)
    expect(client.state.draftSessions[main]).toBe("main")
  } finally {
    client.disconnect()
  }
})

test("the first submitted image draft never appears in ordinary history while its native catalog refresh is pending", async () => {
  const { client } = fixture()
  try {
    await client.connect()
    const id = await client.newImageSession("/tmp", { draft: true })
    const sources: Array<string | undefined> = []
    const stop = client.store.subscribe((state) => {
      const row = state.sessionList.find((row) => row.sessionId === id)
      if (row) sources.push(row.threadSource)
    })
    await client.promptWithImages(id, [{ type: "text", text: "An image request" }])
    stop()
    expect(sources.length).toBeGreaterThan(0)
    expect(sources.every((source) => source === "alwith-images")).toBe(true)
    expect(chatHistoryState(client.state).sessionList.some((row) => row.sessionId === id)).toBe(false)
  } finally {
    client.disconnect()
  }
})

test("model switching cannot reroute an admitted image request and tool results stay on its session", async () => {
  const { fake, selection, generateExternal, client } = fixture()
  await client.connect()
  const sessionId = await client.newSession("/tmp")
  await client.promptWithImages(sessionId, [
    { type: "text", text: "A tree" },
    { type: "image", mimeType: "image/png", data: "aGVsbG8=" }
  ])
  selection.current = { model: "doubao-seedream-5-0-pro-260628", size: "1K" }
  const result = await fake.requestTool({
    sessionId,
    turnId: "turn",
    toolCallId: "image-1",
    name: "generate_image",
    toolSetRevision: "images-v1",
    arguments: { prompt: "A blue tree" }
  })
  expect(generateExternal).toHaveBeenCalledWith(
    { model: "doubao-seedream-4-5-251128", size: "2K" },
    "A blue tree",
    ["data:image/png;base64,aGVsbG8="],
    expect.any(AbortSignal)
  )
  expect(result).toMatchObject({ success: true, contentItems: [{ type: "text" }, { type: "image", data: "aGVsbG8=" }] })
  const second = await client.newSession("/tmp")
  const invalid = await fake.requestTool({
    sessionId: second,
    turnId: "turn",
    toolCallId: "image-2",
    name: "generate_image",
    toolSetRevision: "images-v1",
    arguments: { prompt: "A tree" }
  })
  expect(invalid).toMatchObject({ success: false })
  expect(generateExternal).toHaveBeenCalledTimes(1)
  await client.disconnect()
})

test("unknown reference IDs fail without charging a provider", async () => {
  const { fake, generateExternal, client } = fixture()
  await client.connect()
  const sessionId = await client.newSession("/tmp")
  await client.prompt(sessionId, [{ type: "text", text: "A tree" }])
  const result = await fake.requestTool({
    sessionId,
    name: "generate_image",
    toolSetRevision: "images-v1",
    arguments: { prompt: "Edit it", references: ["invented"] }
  })
  expect(result).toMatchObject({ success: false })
  expect(generateExternal).not.toHaveBeenCalled()
  await client.disconnect()
})

test("a prompt carries its own image selection even when another window's preference event is delayed", async () => {
  const { fake, generateExternal, client } = fixture()
  try {
    await client.connect()
    const id = await client.newImageSession("/tmp")
    const chosen = { model: "doubao-seedream-5-0-pro-260628", size: "1K" }
    await client.promptWithImages(id, [{ type: "text", text: "A mountain" }], {
      meta: { alwith: { imageSelection: chosen } }
    })
    expect(
      await fake.requestTool({
        sessionId: id,
        name: "generate_image",
        toolSetRevision: "images-v1",
        arguments: { prompt: "A mountain" }
      })
    ).toMatchObject({ success: true })
    expect(generateExternal).toHaveBeenCalledWith(chosen, "A mountain", [], expect.any(AbortSignal))
    expect(() =>
      client.promptWithImages(id, [{ type: "text", text: "A mountain" }], {
        meta: { alwith: { imageSelection: { model: "unknown", size: "1K" } } }
      })
    ).toThrow()
    expect(generateExternal).toHaveBeenCalledTimes(1)
  } finally {
    client.disconnect()
  }
})

test("aspect ratio is frozen per prompt and translated to instructions without inventing provider fields", async () => {
  const { fake, generateExternal, client } = fixture()
  try {
    await client.connect()
    const id = await client.newImageSession("/tmp")
    await client.promptWithImages(id, [{ type: "text", text: "A mountain" }], {
      meta: { alwith: { imageAspectRatio: "16:9" } }
    })
    const result = await fake.requestTool({
      sessionId: id,
      name: "generate_image",
      toolSetRevision: "images-v1",
      arguments: { prompt: "A mountain at sunrise" }
    })
    expect(result).toMatchObject({ success: true })
    expect(generateExternal).toHaveBeenCalledWith(
      { model: "doubao-seedream-4-5-251128", size: "2K" },
      expect.stringContaining("aspect ratio of 16:9"),
      [],
      expect.any(AbortSignal)
    )
    expect(() =>
      client.promptWithImages(id, [{ type: "text", text: "A mountain" }], {
        meta: { alwith: { imageAspectRatio: "invalid" } }
      })
    ).toThrow("Invalid image aspect ratio")
    expect(generateExternal).toHaveBeenCalledTimes(1)
  } finally {
    client.disconnect()
  }
})

test("cancelling a session aborts its image request and discards a late provider result", async () => {
  const { fake, generateExternal, client } = fixture()
  let finish!: (result: { images: { mimeType: string; data: string }[] }) => void
  generateExternal.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await client.connect()
  const sessionId = await client.newSession("/tmp")
  await client.prompt(sessionId, [{ type: "text", text: "A tree" }])
  const pending = fake.requestTool({
    sessionId,
    toolCallId: "image-1",
    name: "generate_image",
    toolSetRevision: "images-v1",
    arguments: { prompt: "A tree" }
  })
  await vi.waitFor(() => expect(generateExternal).toHaveBeenCalledOnce())
  const signal = generateExternal.mock.calls[0]![3] as AbortSignal
  await client.cancel(sessionId)
  expect(signal.aborted).toBe(true)
  finish({ images: [{ mimeType: "image/png", data: "aGVsbG8=" }] })
  expect(await pending).toMatchObject({ success: false })
  await client.disconnect()
})
