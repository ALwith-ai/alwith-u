import { expect, test, vi } from "vitest"

import metadata from "../../../guide/catalog.json"
import content from "../../../guide/index.md?raw"
import { parseGuide } from "../../core/docs"
import { CodexClient } from "@alwith/module-chat/client"
import { createDocsTools, docsToolSet } from "../docs-tools"
import { createFakeAgent } from "@alwith/module-chat/testing"
import { FakeHubPort } from "@alwith/module-chat/testing"

const chapters = parseGuide(content, metadata)
function fixture(images = false) {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const inputMode = vi.fn(() => Promise.resolve("image" as const))
  const generateExternal = vi.fn(() => Promise.resolve({ images: [{ mimeType: "image/png", data: "aGVsbG8=" }] }))
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: { engine: "codex" },
    applicationTools: createDocsTools({ chapters, version: "1.2.3" }),
    ...(images
      ? {
          imageService: {
            inputMode,
            selection: () => ({
              model: "doubao-seedream-4-5-251128" as const,
              size: "2K"
            }),
            generateExternal
          }
        }
      : {})
  })
  const requests = vi.spyOn(port, "acpRequest")
  return { client, fake, requests, generateExternal }
}

function payload(outcome: unknown) {
  const { result } = outcome as { result: { isError?: boolean; content: { type: string; text: string }[] } }
  expect(result.isError).toBeUndefined()
  return JSON.parse(result.content[0].text)
}

const declared = { mcpServers: [{ type: "acp", name: "alwith", serverId: expect.any(String) }] }

test("ordinary sessions declare and execute all three documentation tools through the application channel", async () => {
  const { client, fake, requests } = fixture()
  try {
    await client.connect()
    const id = await client.newSession("/project")
    const creation = requests.mock.calls.find((call) => call[1] === "session/new")?.[2]
    expect(creation).toMatchObject(declared)
    expect((await client.readInputConfig(id)).inputConfig).toBeNull()
    const call = (name: string, args: unknown) =>
      fake.requestTool({
        sessionId: id,
        name,
        arguments: args
      })
    const found = payload(await call("alwith_docs_search", { query: "怎么配置模型供应商" }))
    expect(found.version).toBe("1.2.3")
    expect(found.data[0].id).toBe("models")
    const chapter = payload(await call("alwith_docs_fetch", { id: "models" }))
    expect(chapter.data.text).toBe(chapters.find((entry) => entry.id === "models")!.text)
    expect(chapter.data.url).toBe("alwith-docs://guide/models")
    expect(payload(await call("alwith_docs_outline", {})).data).toHaveLength(chapters.length)
    for (const args of [{ id: "../../private" }, { id: "models", extra: true }])
      expect(await call("alwith_docs_fetch", args)).toMatchObject({ result: { isError: true } })
    expect(await call("alwith_docs_fetch", null)).toMatchObject({ error: { code: -32602 } })
  } finally {
    client.disconnect()
  }
})

test("restored and forked sessions receive documentation tools and calls remain bound to their explicit session", async () => {
  const { client, fake, requests } = fixture()
  try {
    await client.connect()
    await client.open("saved-docs", "/project")
    expect(requests.mock.calls.find((call) => call[1] === "session/resume")?.[2]).toMatchObject(declared)
    const fork = await client.fork("saved-docs", "/project")
    const call = (sessionId: string) =>
      fake.requestTool({
        sessionId,
        name: "alwith_docs_outline",
        arguments: {}
      })
    expect(payload(await call(fork)).version).toBe("1.2.3")
    expect(payload(await call("saved-docs")).version).toBe("1.2.3")
    await expect(call("unknown")).rejects.toThrow("declared no application tools")
    await client.close(fork)
    await expect(call(fork)).rejects.toMatchObject({ code: -33001 })
  } finally {
    client.disconnect()
  }
})

test("image and documentation tools coexist without rerouting image calls", async () => {
  const { client, fake, requests, generateExternal } = fixture(true)
  try {
    await client.connect()
    const id = await client.newSession("/project", {
      meta: { alwith: { inputMode: "image" } }
    })
    expect(requests.mock.calls.find((call) => call[1] === "session/new")?.[2]).toMatchObject(declared)
    const listed = (await fake.listTools(id)) as { result: { tools: { name: string }[] } }
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([docsToolSet.definitions[0].name, "generate_image"])
    )
    expect(
      payload(
        await fake.requestTool({
          sessionId: id,
          name: "alwith_docs_outline",
          arguments: {}
        })
      ).version
    ).toBe("1.2.3")
    await client.promptWithImages(id, [{ type: "text", text: "A tree" }])
    expect(
      await fake.requestTool({
        sessionId: id,
        name: "generate_image",
        arguments: { prompt: "A tree" }
      })
    ).not.toHaveProperty("result.isError")
    expect(generateExternal).toHaveBeenCalledTimes(1)
  } finally {
    client.disconnect()
  }
})

test("guide tools are read-only, so the agent runs them without asking", async () => {
  const { client, fake } = fixture()
  try {
    await client.connect()
    const id = await client.newSession("/project")
    const listed = (await fake.listTools(id)) as {
      result: { tools: { name: string; annotations?: Record<string, unknown> }[] }
    }
    for (const tool of docsToolSet.definitions)
      expect(listed.result.tools.find((entry) => entry.name === tool.name)?.annotations).toEqual({ readOnlyHint: true })
  } finally {
    client.disconnect()
  }
})
