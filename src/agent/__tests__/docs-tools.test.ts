import { expect, test, vi } from "vitest"

import metadata from "../../../guide/catalog.json"
import content from "../../../guide/index.md?raw"
import { parseGuide } from "../../core/docs"
import { CodexClient } from "../client"
import { createDocsTools, docsToolSet } from "../docs-tools"
import { createFakeAgent } from "./fake-agent"
import { FakeHubPort } from "./fake-runtime-client"

const docsRevisions = docsToolSet.definitions.map((tool) => [tool.name, docsToolSet.revision])
const docsRevision = JSON.stringify(docsRevisions)
const imageDocsRevision = JSON.stringify([...docsRevisions, ["generate_image", "images-v1"]])

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

function payload(result: unknown) {
  const response = result as {
    success: boolean
    contentItems: { type: string; text: string }[]
  }
  expect(response.success).toBe(true)
  return JSON.parse(response.contentItems[0].text)
}

test("ordinary sessions declare and execute all three documentation tools through the application channel", async () => {
  const { client, fake, requests } = fixture()
  try {
    await client.connect()
    const id = await client.newSession("/project")
    const creation = requests.mock.calls.find((call) => call[1] === "session/new")?.[2]
    expect(creation).toMatchObject({
      _meta: {
        alwith: {
          tools: docsToolSetWithRevision(docsRevision)
        }
      }
    })
    expect((await client.readInputConfig(id)).inputConfig).toBeNull()
    const call = (name: string, args: unknown) =>
      fake.requestTool({
        sessionId: id,
        toolSetRevision: docsRevision,
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
    for (const args of [{ id: "../../private" }, { id: "models", extra: true }, null])
      expect(await call("alwith_docs_fetch", args)).toMatchObject({
        success: false
      })
  } finally {
    client.disconnect()
  }
})

function docsToolSetWithRevision(revision: string) {
  return { ...docsToolSet, revision }
}

test("restored and forked sessions receive documentation tools and calls remain bound to their explicit session", async () => {
  const { client, fake, requests } = fixture()
  try {
    await client.connect()
    await client.open("saved-docs", "/project")
    expect(requests.mock.calls.find((call) => call[1] === "session/resume")?.[2]).toMatchObject({
      _meta: {
        alwith: {
          tools: docsToolSetWithRevision(docsRevision)
        }
      }
    })
    const fork = await client.fork("saved-docs", "/project")
    const call = (sessionId: string, revision = docsRevision) =>
      fake.requestTool({
        sessionId,
        toolSetRevision: revision,
        name: "alwith_docs_outline",
        arguments: {}
      })
    expect(payload(await call(fork)).version).toBe("1.2.3")
    expect(payload(await call("saved-docs")).version).toBe("1.2.3")
    expect(await call("unknown")).toMatchObject({ success: false })
    expect(await call(fork, "stale")).toMatchObject({ success: false })
    await client.close(fork)
    expect(await call(fork)).toMatchObject({ success: false })
  } finally {
    client.disconnect()
  }
})

test("image and documentation tools coexist with one revision without rerouting image calls", async () => {
  const { client, fake, requests, generateExternal } = fixture(true)
  try {
    await client.connect()
    const id = await client.newSession("/project", {
      meta: { alwith: { inputMode: "image" } }
    })
    const creation = requests.mock.calls.find((call) => call[1] === "session/new")?.[2]
    expect(creation).toMatchObject({
      _meta: {
        alwith: {
          tools: {
            revision: imageDocsRevision,
            definitions: expect.arrayContaining([
              { ...docsToolSet.definitions[0] },
              expect.objectContaining({ name: "generate_image" })
            ])
          }
        }
      }
    })
    expect(
      payload(
        await fake.requestTool({
          sessionId: id,
          toolSetRevision: imageDocsRevision,
          name: "alwith_docs_outline",
          arguments: {}
        })
      ).version
    ).toBe("1.2.3")
    await client.promptWithImages(id, [{ type: "text", text: "A tree" }])
    expect(
      await fake.requestTool({
        sessionId: id,
        toolSetRevision: imageDocsRevision,
        name: "generate_image",
        arguments: { prompt: "A tree" }
      })
    ).toMatchObject({ success: true })
    expect(generateExternal).toHaveBeenCalledTimes(1)
  } finally {
    client.disconnect()
  }
})

test("installed shared client approves live guide calls while other tools still require review", async () => {
  const { client, fake } = fixture()
  try {
    await client.connect()
    const id = await client.newSession("/project", {
      meta: { codex: { mode: "agent" } }
    })
    await fake.pushUpdate(id, {
      sessionUpdate: "state_update",
      state: "running"
    })
    const request = (toolCallId: string) =>
      fake.requestPermission({
        sessionId: id,
        title: "Search the installed ALwith U user guide",
        subject: {
          type: "tool_call",
          toolCall: { toolCallId, kind: "other", status: "pending" }
        },
        options: [
          { optionId: "allow_once", kind: "allow_once", name: "Allow" },
          { optionId: "reject_once", kind: "reject_once", name: "Reject" }
        ]
      })
    for (const tool of docsToolSet.definitions) {
      await fake.pushUpdate(id, {
        sessionUpdate: "tool_call_update",
        toolCallId: tool.name,
        name: `alwith_client_${tool.name}`,
        title: "Translated tool title",
        status: "in_progress"
      })
      // Request immediately: the UI snapshot may still be waiting for its render batch.
      expect(await request(tool.name)).toEqual({
        outcome: { outcome: "selected", optionId: "allow_once" }
      })
      expect(client.state.actions).toHaveLength(0)
    }
    for (const name of ["exec_command", "alwith_client_generate_image", "alwith_client_unregistered"]) {
      await fake.pushUpdate(id, {
        sessionUpdate: "tool_call_update",
        toolCallId: name,
        name,
        title: "Search the installed ALwith U user guide",
        status: "in_progress"
      })
      const pending = request(name)
      await vi.waitFor(() => expect(client.state.actions).toHaveLength(1))
      client.respond(client.state.actions[0].id, {
        outcome: { outcome: "selected", optionId: "reject_once" }
      })
      expect(await pending).toEqual({
        outcome: { outcome: "selected", optionId: "reject_once" }
      })
    }
  } finally {
    client.disconnect()
  }
})
