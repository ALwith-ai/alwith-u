// Exercise provider routing against real isolated Codex processes and a local Responses fixture.
import { resolve } from "node:path"

import { startTestRuntime } from "@alwith/api/node"
import { textOf } from "@nyssance/codex-acp-v2/client"

import { CodexClient } from "../src/agent/client"
import { staged, stagedCodexEngine } from "./lib/runtime"

const requests: { model: string; path: string }[] = []
let failNext = false
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path.endsWith("/models")) return Response.json({ data: [{ id: "deepseek-flash" }, { id: "alternate-model" }] })
    const body = (await request.json()) as { model: string }
    requests.push({ model: body.model, path })
    if (failNext) {
      failNext = false
      return Response.json({ error: { message: "Intentional provider failure" } }, { status: 400 })
    }
    const id = `resp_${crypto.randomUUID()}`
    const item = {
      type: "message",
      id: `msg_${crypto.randomUUID()}`,
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "PROVIDER_OK", annotations: [] }]
    }
    const response = {
      id,
      object: "response",
      status: "completed",
      model: body.model,
      output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
    }
    const events = [
      { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
      {
        type: "response.content_part.added",
        output_index: 0,
        item_id: item.id,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] }
      },
      { type: "response.output_text.delta", output_index: 0, item_id: item.id, content_index: 0, delta: "PROVIDER_OK" },
      { type: "response.output_text.done", output_index: 0, item_id: item.id, content_index: 0, text: "PROVIDER_OK" },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response }
    ]
    return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
      headers: { "Content-Type": "text/event-stream" }
    })
  }
})

const runtime = await startTestRuntime({ binary: staged("alwith-runtime"), engines: { codex: stagedCodexEngine() } })
const client = new CodexClient(() => Promise.resolve(runtime.client), {
  agentId: "codex",
  launch: { engine: "codex" },
  resolveModel: async (model) => model ?? gateway("one")
})
const ids: string[] = []
const catalog = resolve(import.meta.dirname, "../src-tauri/resources/deepseek/models.json")
const gateway = (provider: string, model = "deepseek-flash") => `gateway:${provider}:${model}`
async function reply(id: string, label: string) {
  const previous = client.session(id).items.length
  await client.prompt(id, [{ type: "text", text: "Reply with PROVIDER_OK" }])
  const deadline = Date.now() + 20_000
  while (client.session(id).state !== "idle" || client.session(id).items.length === previous) {
    if (Date.now() > deadline) throw new Error(`${label}: timed out`)
    await Bun.sleep(20)
  }
  if (client.session(id).lastStopReason !== "end_turn")
    throw new Error(`${label}: ${JSON.stringify(client.session(id).error)}`)
  if (
    !client.session(id).items.some((item) => item.kind === "assistant" && textOf(item.content).includes("PROVIDER_OK"))
  )
    throw new Error(`${label}: missing provider output`)
  console.log(
    `PASS ${label}: ${JSON.stringify({ request: requests.at(-1), selected: client.session(id).configOptions.find((option) => option.category === "model")?.currentValue })}`
  )
}
try {
  await client.connect()
  for (const id of ["one", "two"]) {
    await runtime.client.acpRequest("codex", "providers/set", {
      providerId: "openai",
      apiType: "openai",
      baseUrl: `${server.url}${id}/`,
      _meta: {
        codex: {
          id,
          name: id,
          mode: "catalog",
          bearerToken: "local-fixture",
          config: { model_catalog_json: catalog, web_search: "disabled" }
        },
        alwith: { models: [{ id: "deepseek-flash" }, { id: "alternate-model" }] }
      }
    })
  }
  const id = await client.newSession(runtime.workspace, gateway("one"))
  ids.push(id)
  await reply(id, "cold start without Codex account")
  failNext = true
  await client.prompt(id, [{ type: "text", text: "Exercise provider failure" }])
  const failedDeadline = Date.now() + 20_000
  while (client.session(id).state !== "idle") {
    if (Date.now() > failedDeadline) throw new Error("Failed turn did not settle")
    await Bun.sleep(20)
  }
  if (client.session(id).lastStopReason !== "error") throw new Error("Expected the fixture failure")
  await client.setConfig(id, "model", gateway("two"))
  await reply(id, "switch after a failed native turn")
  for (const model of [gateway("two"), gateway("one"), gateway("one", "alternate-model"), gateway("two")]) {
    await client.setConfig(id, "model", model)
    await reply(id, `switch to ${model}`)
  }
  await client.close(id)
  await client.open(id, runtime.workspace)
  await reply(id, "reopen gateway session without Codex account")
  const defaultId = await client.newSession(runtime.workspace)
  ids.push(defaultId)
  await reply(defaultId, "configured default without Codex account")
  const draft = await client.prepareDraft("main", runtime.workspace)
  ids.push(draft)
  const replacement = await client.prepareDraft("main", runtime.workspace, gateway("two"))
  ids.push(replacement)
  await reply(replacement, "switch unsent draft between providers")
} finally {
  for (const id of ids) await client.delete(id).catch(() => {})
  client.disconnect()
  await runtime.dispose()
  server.stop(true)
}
