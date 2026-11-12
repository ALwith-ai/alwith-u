import type { ImageSelection } from "@alwith/module-chat/image"
import { expect, test, vi } from "vitest"

import { CodexClient } from "../client"
import { resolveInputMode } from "../input-modes"
import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

function fixture() {
  const inputMode = vi.fn((_id: string): Promise<"chat" | "image"> => Promise.resolve("chat"))
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const selection: { current: ImageSelection } = { current: { model: "doubao-seedream-4-5-251128", size: "2K" } }
  const generateExternal = vi.fn(
    (_selection: ImageSelection, _prompt: string, _images: string[], _signal?: AbortSignal) =>
      Promise.resolve({ images: [{ mimeType: "image/png", data: "aGVsbG8=" }] })
  )
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: { engine: "codex" },
    imageService: { inputMode, selection: () => selection.current, generateExternal }
  })
  return { fake, port, selection, generateExternal, client, inputMode }
}

test("ChatGPT images use the adapter account extension and keep an ordinary session", async () => {
  const { fake, port, selection, generateExternal, client } = fixture()
  selection.current = { model: "wham", size: "auto" }
  const request = vi.spyOn(port, "acpRequest")
  const generate = vi.fn(() => Promise.resolve({ images: [{ mimeType: "image/png", data: "cG5n" }] }))
  fake.app.onRequest("_codex/images/generate", (params: unknown) => params, generate)
  try {
    await client.connect()
    const id = await client.newSession("/tmp", { meta: { alwith: { inputMode: "image" } } })
    await client.promptWithImages(id, [{ type: "text", text: "A tree" }])
    const result = await fake.requestTool({
      sessionId: id,
      toolCallId: "image",
      name: "generate_image",
      toolSetRevision: JSON.stringify([["generate_image", "images-v1"]]),
      arguments: { prompt: "A tree" }
    })
    expect(result).toMatchObject({ success: true, contentItems: [{ type: "text" }, { type: "image", data: "cG5n" }] })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generateExternal).not.toHaveBeenCalled()
    const creation = request.mock.calls.find((call) => call[1] === "session/new")?.[2]
    expect(creation).not.toHaveProperty("_meta.codex.threadSource")
  } finally {
    client.disconnect()
  }
})

test("model switching cannot reroute an admitted image request and tool results stay on its session", async () => {
  const { fake, selection, generateExternal, client } = fixture()
  await client.connect()
  const sessionId = await client.newSession("/tmp", { meta: { alwith: { inputMode: "image" } } })
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
    toolSetRevision: JSON.stringify([["generate_image", "images-v1"]]),
    arguments: { prompt: "A blue tree" }
  })
  expect(generateExternal).toHaveBeenCalledWith(
    { model: "doubao-seedream-4-5-251128", size: "2K" },
    "A blue tree",
    ["data:image/png;base64,aGVsbG8="],
    expect.any(AbortSignal)
  )
  expect(result).toMatchObject({ success: true, contentItems: [{ type: "text" }, { type: "image", data: "aGVsbG8=" }] })
  const second = await client.newSession("/tmp", { meta: { alwith: { inputMode: "image" } } })
  const invalid = await fake.requestTool({
    sessionId: second,
    turnId: "turn",
    toolCallId: "image-2",
    name: "generate_image",
    toolSetRevision: JSON.stringify([["generate_image", "images-v1"]]),
    arguments: { prompt: "A tree" }
  })
  expect(invalid).toMatchObject({ success: false })
  expect(generateExternal).toHaveBeenCalledTimes(1)
  client.disconnect()
})

test("unknown reference IDs fail without charging a provider", async () => {
  const { fake, generateExternal, client } = fixture()
  await client.connect()
  const sessionId = await client.newSession("/tmp", { meta: { alwith: { inputMode: "image" } } })
  await client.prompt(sessionId, [{ type: "text", text: "A tree" }])
  const result = await fake.requestTool({
    sessionId,
    name: "generate_image",
    toolSetRevision: JSON.stringify([["generate_image", "images-v1"]]),
    arguments: { prompt: "Edit it", references: ["invented"] }
  })
  expect(result).toMatchObject({ success: false })
  expect(generateExternal).not.toHaveBeenCalled()
  client.disconnect()
})

test("a prompt carries its own image selection even when another window's preference event is delayed", async () => {
  const { fake, generateExternal, client } = fixture()
  try {
    await client.connect()
    const id = await client.newSession("/tmp", { meta: { alwith: { inputMode: "image" } } })
    const chosen = { model: "doubao-seedream-5-0-pro-260628", size: "1K" }
    await client.promptWithImages(id, [{ type: "text", text: "A mountain" }], {
      meta: { alwith: { imageSelection: chosen } }
    })
    expect(
      await fake.requestTool({
        sessionId: id,
        name: "generate_image",
        toolSetRevision: JSON.stringify([["generate_image", "images-v1"]]),
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
    const id = await client.newSession("/tmp", { meta: { alwith: { inputMode: "image" } } })
    await client.promptWithImages(id, [{ type: "text", text: "A mountain" }], {
      meta: { alwith: { imageAspectRatio: "16:9" } }
    })
    const result = await fake.requestTool({
      sessionId: id,
      name: "generate_image",
      toolSetRevision: JSON.stringify([["generate_image", "images-v1"]]),
      arguments: { prompt: "A mountain at sunrise" }
    })
    expect(result).toMatchObject({ success: true })
    expect(generateExternal).toHaveBeenCalledWith(
      { model: "doubao-seedream-4-5-251128", size: "2K" },
      expect.stringContaining("aspect ratio of 16:9") as unknown,
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
  const sessionId = await client.newSession("/tmp", { meta: { alwith: { inputMode: "image" } } })
  await client.prompt(sessionId, [{ type: "text", text: "A tree" }])
  const pending = fake.requestTool({
    sessionId,
    toolCallId: "image-1",
    name: "generate_image",
    toolSetRevision: JSON.stringify([["generate_image", "images-v1"]]),
    arguments: { prompt: "A tree" }
  })
  await vi.waitFor(() => expect(generateExternal).toHaveBeenCalledOnce())
  const signal = generateExternal.mock.calls[0][3]
  await client.cancel(sessionId)
  expect(signal?.aborted).toBe(true)
  finish({ images: [{ mimeType: "image/png", data: "aGVsbG8=" }] })
  expect(await pending).toMatchObject({ success: false })
  client.disconnect()
})

test("image intent stays on its image session while ordinary chat uses native generation", async () => {
  const { port, client } = fixture()
  const request = vi.spyOn(port, "acpRequest")
  const prompt = [
    { type: "text" as const, text: "A tree" },
    { type: "image" as const, mimeType: "image/png", data: "aGVsbG8=" }
  ]
  try {
    await client.connect()
    const id = await client.newSession("/tmp", { meta: { alwith: { inputMode: "image" } } })
    await client.promptWithImages(id, prompt)
    const ordinary = await client.newSession("/tmp")
    await client.prompt(ordinary, [{ type: "text", text: "Explain the result" }])
    const calls = request.mock.calls.filter((call) => call[1] === "session/prompt").map((call) => call[2])
    expect(calls[0]).toMatchObject({
      prompt,
      _meta: {
        alwith: {
          applicationContext: {
            "alwith.imageIntent": expect.stringContaining("application generate_image tool") as unknown
          }
        }
      }
    })
    expect(calls[1]).toMatchObject({
      prompt: [{ type: "text", text: "Explain the result" }],
      _meta: {
        alwith: {
          applicationContext: {
            "alwith.imageIntent": expect.stringContaining("use the native image generation tool") as unknown
          }
        }
      }
    })
  } finally {
    client.disconnect()
  }
})

test("ordinary conversations do not advertise or execute the application image tool", async () => {
  const { client, fake, port, generateExternal, selection } = fixture()
  const request = vi.spyOn(port, "acpRequest")
  try {
    await client.connect()
    const id = await client.newSession("/tmp")
    await client.prompt(id, [{ type: "text", text: "Draw a tree" }])
    const created = request.mock.calls.find((call) => call[1] === "session/new")?.[2]
    expect(created).toMatchObject({ _meta: { alwith: { nativeTools: {} } } })
    expect(created).not.toHaveProperty("_meta.alwith.tools")
    expect(created).toMatchObject({ _meta: { alwith: { nativeTools: {} } } })
    const prompt = request.mock.calls.find((call) => call[1] === "session/prompt")?.[2]
    expect(prompt).toMatchObject({
      _meta: {
        alwith: {
          applicationContext: {
            "alwith.imageIntent": expect.stringContaining("use the native image generation tool") as unknown
          }
        }
      }
    })
    expect(prompt).not.toHaveProperty("_meta.alwith.imageSelection")
    expect(prompt).not.toHaveProperty("_meta.alwith.imageInstructions")
    // A tool left in an older rollout must not reach the configured provider.
    const result = await fake.requestTool({
      sessionId: id,
      name: "generate_image",
      toolSetRevision: JSON.stringify([["generate_image", "images-v1"]]),
      arguments: { prompt: "A tree" }
    })
    expect(result).toMatchObject({ success: false })
    expect(generateExternal).not.toHaveBeenCalled()
    selection.current = { model: "doubao-seedream-5-0-pro-260628", size: "4K" }
    await client.prompt(id, [{ type: "text", text: "Make it blue" }], {
      meta: { alwith: { imageIntent: "edit" } }
    })
    const prompts = request.mock.calls.filter((call) => call[1] === "session/prompt").map((call) => call[2])
    expect(prompts.at(-1)).toMatchObject({
      _meta: {
        alwith: {
          applicationContext: {
            "alwith.imageIntent": expect.stringContaining("use the native image generation tool") as unknown
          }
        }
      }
    })
    expect(generateExternal).not.toHaveBeenCalled()
  } finally {
    client.disconnect()
  }
})

test("restoring a saved image conversation restores its application tools before sending", async () => {
  const { client, inputMode, port, fake, generateExternal } = fixture()
  const request = vi.spyOn(port, "acpRequest")
  inputMode.mockResolvedValue("image")
  try {
    await client.connect()
    await client.open("saved-image", "/tmp")
    expect(inputMode).toHaveBeenCalledWith("saved-image")
    const setup = request.mock.calls.find((call) => call[1] === "session/resume")?.[2]
    expect(setup).toMatchObject({
      _meta: {
        alwith: { nativeTools: { imageGeneration: false }, tools: { definitions: [{ name: "generate_image" }] } }
      }
    })
    await client.prompt("saved-image", [{ type: "text", text: "Edit the image" }], {
      meta: { alwith: { imageIntent: "edit", imageSelection: { model: "doubao-seedream-5-0-pro-260628", size: "1K" } } }
    })
    expect(
      await fake.requestTool({
        sessionId: "saved-image",
        name: "generate_image",
        toolSetRevision: JSON.stringify([["generate_image", "images-v1"]]),
        arguments: { prompt: "Edited" }
      })
    ).toMatchObject({ success: true })
    expect(generateExternal).toHaveBeenCalledWith(
      { model: "doubao-seedream-5-0-pro-260628", size: "1K" },
      "Edited",
      [],
      expect.any(AbortSignal)
    )
  } finally {
    client.disconnect()
  }
})

test("changing the main draft mode replaces its tool registration and floating drafts stay chat-only", async () => {
  const { client, port } = fixture()
  const request = vi.spyOn(port, "acpRequest")
  try {
    await client.connect()
    const chat = await client.prepareDraft("main", "/tmp")
    const image = await client.prepareDraft("main", "/tmp", null, false, "image")
    expect(image).not.toBe(chat)
    const creations = request.mock.calls.filter((call) => call[1] === "session/new").map((call) => call[2])
    expect(creations[0]).not.toHaveProperty("_meta.alwith.tools")
    expect(creations[1]).toMatchObject({
      _meta: {
        alwith: { nativeTools: { imageGeneration: false }, tools: { definitions: [{ name: "generate_image" }] } }
      }
    })
    await expect(client.open(image, "/tmp", "chat")).rejects.toThrow("main window")
    await expect(client.transferDraft(image, "chat")).rejects.toThrow("main window")
    expect(() => client.prepareDraft("chat", "/tmp", null, false, "image")).toThrow("floating chat")
    const floating = await client.prepareDraft("chat", "/tmp")
    await client.prompt(floating, [{ type: "text", text: "Draw a tree" }])
    const prompts = request.mock.calls.filter((call) => call[1] === "session/prompt").map((call) => call[2])
    expect(prompts.at(-1)).toMatchObject({
      _meta: {
        alwith: {
          applicationContext: {
            "alwith.imageIntent": expect.stringContaining("use the native image generation tool") as unknown
          }
        }
      }
    })
  } finally {
    client.disconnect()
  }
})

test("reopening reads native mode and image selection without a UI read priming the client cache", async () => {
  const { client, port, selection, inputMode, fake, generateExternal } = fixture()
  inputMode.mockImplementation(async (id) => resolveInputMode((await client.readInputConfig(id)).inputConfig))
  const request = vi.spyOn(port, "acpRequest")
  const saved: ImageSelection = { model: "doubao-seedream-5-0-pro-260628", size: "2K" }
  await client.connect()
  try {
    const id = await client.newSession("/tmp", { meta: { alwith: { inputMode: "image" } } })
    await client.writeInputConfig(id, { mode: "image", config: saved })
    await client.close(id)
    selection.current = { model: "wham", size: "auto" }
    await client.open(id, "/tmp")
    const resumed = request.mock.calls.findLast((call) => call[1] === "session/resume")?.[2]
    expect(resumed).toMatchObject({
      _meta: {
        alwith: { nativeTools: { imageGeneration: false }, tools: { definitions: [{ name: "generate_image" }] } }
      }
    })
    await client.prompt(id, [{ type: "text", text: "A blue tree" }])
    const sent = request.mock.calls.findLast((call) => call[1] === "session/prompt")?.[2]
    expect(sent).toMatchObject({
      sessionId: id,
      _meta: {
        alwith: {
          applicationContext: {
            "alwith.imageIntent": expect.stringContaining("application generate_image tool") as unknown
          }
        }
      }
    })
    expect(sent).not.toHaveProperty("_meta.alwith.imageSelection")
    expect(sent).not.toHaveProperty("_meta.alwith.imageIntent")
    await fake.requestTool({
      sessionId: id,
      name: "generate_image",
      toolSetRevision: JSON.stringify([["generate_image", "images-v1"]]),
      arguments: { prompt: "A blue tree" }
    })
    expect(generateExternal).toHaveBeenCalledWith(saved, "A blue tree", [], expect.any(AbortSignal))
    expect(selection.current).toEqual({ model: "wham", size: "auto" })
  } finally {
    client.disconnect()
  }
})

test("restoration reads mode before registering tools and never falls back after a read failure", async () => {
  const { client, inputMode, port } = fixture()
  const request = vi.spyOn(port, "acpRequest")
  await client.connect()
  try {
    inputMode.mockRejectedValue(new Error("Native config read failed"))
    await expect(client.open("unread", "/tmp")).rejects.toThrow("Native config read failed")
    expect(request.mock.calls.filter((call) => call[1] === "session/resume")).toHaveLength(0)
  } finally {
    client.disconnect()
  }
})

test("ordinary mode removes inherited application tools and execution overrides before creating the session", async () => {
  const { client, port } = fixture()
  const request = vi.spyOn(port, "acpRequest")
  await client.connect()
  try {
    await client.newSession("/tmp", {
      meta: {
        alwith: {
          inputMode: "chat",
          nativeTools: { imageGeneration: false },
          tools: { revision: "stale", definitions: [] }
        }
      }
    })
    const created = request.mock.calls.find((call) => call[1] === "session/new")?.[2]
    expect(created).toMatchObject({ _meta: { alwith: { nativeTools: {} } } })
    expect(created).not.toHaveProperty("_meta.alwith.tools")
    expect(created).not.toHaveProperty("_meta.alwith.inputMode")
  } finally {
    client.disconnect()
  }
})

test("ordinary restore stays native without writing a configuration even when recent image choices exist", async () => {
  const { client, inputMode, port, selection } = fixture()
  inputMode.mockImplementation(async (id) => resolveInputMode((await client.readInputConfig(id)).inputConfig))
  const request = vi.spyOn(port, "acpRequest")
  await client.connect()
  try {
    const id = await client.newSession("/tmp")
    await client.close(id)
    selection.current = { model: "doubao-seedream-5-0-pro-260628", size: "4K" }
    await client.open(id, "/tmp")
    await client.prompt(id, [{ type: "text", text: "Hello" }])
    const restored = request.mock.calls.findLast((call) => call[1] === "session/resume")?.[2]
    expect(restored).toMatchObject({ _meta: { alwith: { nativeTools: {} } } })
    expect(restored).not.toHaveProperty("_meta.alwith.tools")
    expect(request.mock.calls.filter((call) => call[1] === "_codex/session_input_config_set")).toHaveLength(0)
    const prompt = request.mock.calls.findLast((call) => call[1] === "session/prompt")?.[2]
    expect(prompt).toHaveProperty(
      ["_meta", "alwith", "applicationContext", "alwith.imageIntent"],
      expect.stringContaining("use the native image generation tool")
    )
    expect(prompt).not.toHaveProperty("_meta.alwith.imageSelection")
  } finally {
    client.disconnect()
  }
})

test.each(["MiniMax-H3-Image", "MiniMax-H3-Image-Highspeed"] as const)(
  "%s uses the existing image tool for generation and follow-up reference editing",
  async (model) => {
    const { fake, selection, generateExternal, client } = fixture()
    selection.current = { model, size: "4K" }
    try {
      await client.connect()
      const sessionId = await client.newSession("/tmp", { meta: { alwith: { inputMode: "image" } } })
      await client.promptWithImages(sessionId, [{ type: "text", text: "A tree" }])
      const generate = await fake.requestTool({
        sessionId,
        toolCallId: "minimax-original",
        name: "generate_image",
        toolSetRevision: JSON.stringify([["generate_image", "images-v1"]]),
        arguments: { prompt: "A tree" }
      })
      expect(generate).toMatchObject({ success: true })
      expect(generateExternal).toHaveBeenLastCalledWith({ model, size: "4K" }, "A tree", [], expect.any(AbortSignal))
      const edit = await fake.requestTool({
        sessionId,
        toolCallId: "minimax-edit",
        name: "generate_image",
        toolSetRevision: JSON.stringify([["generate_image", "images-v1"]]),
        arguments: { prompt: "Make the leaves blue", references: ["minimax-original:1"] }
      })
      expect(edit).toMatchObject({ success: true })
      expect(generateExternal).toHaveBeenLastCalledWith(
        { model, size: "4K" },
        "Make the leaves blue",
        ["data:image/png;base64,aGVsbG8="],
        expect.any(AbortSignal)
      )
    } finally {
      client.disconnect()
    }
  }
)
