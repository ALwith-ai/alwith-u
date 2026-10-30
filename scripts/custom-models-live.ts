// Exercise the published Runtime, adapter and Codex against a local Responses fixture or saved endpoints.
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { startTestRuntime } from "@alwith/api/node"
import { isGroupedSelect, isSelectOption, isText } from "@nyssance/codex-acp-v2/client"

import catalog from "../src-tauri/resources/custom/models.json"
import { CodexClient } from "../src/agent/client"
import { staged, stagedCodexEngine } from "./lib/runtime"

interface SavedProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: Array<{ api_id: string; label: string }>
}
interface WireRequest {
  model: string
  reasoning?: { effort?: string; summary?: string }
  text?: { verbosity?: string }
  tools?: Array<{ type: string; name?: string }>
  input?: Array<{ type: string }>
}

const providersPath = process.argv.find((arg) => arg.startsWith("--providers="))?.slice("--providers=".length)
const stdinCredentials = process.argv.includes("--stdin")
const live = stdinCredentials || providersPath !== undefined
const requests: WireRequest[] = []
const marker = "CUSTOM_MODEL_OK"
const fixture = live
  ? null
  : Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as WireRequest
        requests.push(body)
        const id = `resp_fixture_${requests.length}`
        const output = [
          {
            id: `msg_${requests.length}`,
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: marker, annotations: [] }]
          }
        ]
        const response = {
          id,
          object: "response",
          model: body.model,
          status: "completed",
          output,
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
        }
        const events = [
          {
            type: "response.created",
            response: { ...response, status: "in_progress", output: [] }
          },
          {
            type: "response.output_item.added",
            output_index: 0,
            item: { ...output[0], content: [] }
          },
          {
            type: "response.output_text.delta",
            item_id: output[0].id,
            output_index: 0,
            content_index: 0,
            delta: marker
          },
          {
            type: "response.output_item.done",
            output_index: 0,
            item: output[0]
          },
          { type: "response.completed", response }
        ]
        return new Response(
          events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
          {
            headers: { "content-type": "text/event-stream" }
          }
        )
      }
    })

async function configured(): Promise<SavedProvider[]> {
  if (!live) {
    assert.ok(fixture)
    return [
      {
        id: "custom-fixture",
        name: "Fixture",
        baseUrl: `${fixture.url}v1`,
        apiKey: "fixture-token",
        models: catalog.models.map((model) => ({
          api_id: model.slug,
          label: model.display_name
        }))
      }
    ]
  }
  const source = stdinCredentials ? await Bun.stdin.text() : await readFile(providersPath!, "utf8")
  const saved = JSON.parse(source) as {
    custom_providers: Record<string, SavedProvider>
  }
  const providers = Object.values(saved.custom_providers).filter((provider) =>
    provider.models.some((model) => catalog.models.some((entry) => entry.slug === model.api_id))
  )
  if (process.argv.includes("--all-models")) {
    for (const provider of providers) {
      const host = new URL(provider.baseUrl).hostname
      const prefix = host === "open.bigmodel.cn" ? "glm-" : host === "api.moonshot.cn" ? "kimi-" : null
      if (prefix)
        provider.models = catalog.models
          .filter((model) => model.slug.startsWith(prefix))
          .map((model) => ({ api_id: model.slug, label: model.display_name }))
    }
  }
  return providers
}

try {
  await using runtime = await startTestRuntime({
    binary: staged("alwith-runtime"),
    engines: { codex: stagedCodexEngine() }
  })
  // Reproduce a user's global preference without reading or changing the real Codex home.
  await writeFile(resolve(runtime.codexHome, "config.toml"), 'model_reasoning_effort = "medium"\n')
  await writeFile(resolve(runtime.workspace, "probe.txt"), marker)
  const client = new CodexClient(() => Promise.resolve(runtime.client), {
    agentId: "codex",
    launch: { engine: "codex", env: { INITIAL_AGENT_MODE: "read-only" } }
  })
  const evidence: Array<{ model: string; efforts: string[]; replies: number }> = []
  try {
    await client.connect()
    const providers = await configured()
    assert.ok(providers.length > 0, "No configured endpoint matches the custom model catalog")
    for (const provider of providers) {
      await runtime.client.acpRequest("codex", "providers/set", {
        providerId: "openai",
        apiType: "openai",
        baseUrl: provider.baseUrl,
        _meta: {
          codex: {
            id: provider.id.replaceAll("_", "-"),
            name: provider.name,
            mode: "catalog",
            bearerToken: provider.apiKey,
            config: {
              web_search: "disabled",
              model_reasoning_summary: "none",
              model_catalog_json: resolve("src-tauri/resources/custom/models.json")
            }
          },
          alwith: {
            models: provider.models.map((model) => ({
              id: model.api_id,
              label: model.label
            }))
          }
        }
      })
      let sessionId: string | undefined
      for (const entry of provider.models) {
        const model = catalog.models.find((item) => item.slug === entry.api_id)
        if (!model) continue
        const selection = `gateway:${encodeURIComponent(provider.id.replaceAll("_", "-"))}:${encodeURIComponent(model.slug)}`
        if (sessionId) await client.setConfig(sessionId, "model", selection)
        else sessionId = await client.newSession(runtime.workspace, selection)
        const selector = client.session(sessionId).configOptions.find((option) => option.category === "model")
        assert.ok(selector && isSelectOption(selector) && isGroupedSelect(selector.options))
        const nativeModels = selector.options.find((group) => group.groupId === "chatgpt")?.options ?? []
        assert.ok(
          nativeModels.every((option) => !catalog.models.some((entry) => entry.slug === option.value)),
          "Custom metadata must not advertise unconfigured models as native ChatGPT selections"
        )
        const effort = client.session(sessionId).configOptions.find((option) => option.category === "thought_level")
        const expected = model.supported_reasoning_levels.map((level) => level.effort)
        if (expected.length === 0) assert.equal(effort, undefined, `${model.slug}: unsupported effort must be hidden`)
        else {
          assert.ok(effort && isSelectOption(effort), `${model.slug}: missing effort selector`)
          assert.deepEqual(
            effort.options.map((option) => ("value" in option ? option.value : null)),
            expected
          )
          assert.equal(
            effort.currentValue,
            model.default_reasoning_level,
            `${model.slug}: must start on its default effort`
          )
        }
        const levels =
          live && !process.argv.includes("--all-efforts") ? [null] : expected.length > 0 ? [null, ...expected] : [null]
        let replies = 0
        for (const level of levels) {
          if (effort && level) await client.setConfig(sessionId, effort.configId, level)
          const previous: number = client.session(sessionId).items.length
          await client.prompt(sessionId, [
            {
              type: "text",
              text: live
                ? "Use the terminal tool to read probe.txt in the current directory. Reply with its exact content. Do not modify files."
                : `Reply with exactly ${marker}. Do not use tools.`
            }
          ])
          const deadline = Date.now() + 120_000
          while (client.session(sessionId).state !== "idle") {
            assert.ok(Date.now() < deadline, `${model.slug}: timed out`)
            await Bun.sleep(50)
          }
          const session = client.session(sessionId)
          assert.equal(session.lastStopReason, "end_turn", `${model.slug}: ${JSON.stringify(session.error)}`)
          const text: string = session.items
            .slice(previous)
            .filter((item) => item.kind === "assistant")
            .flatMap((item) => (item.kind === "assistant" ? item.content : []))
            .filter(isText)
            .map((block) => block.text)
            .join("")
          assert.ok(text.includes(marker), `${model.slug}: missing expected reply`)
          if (fixture) {
            const wire = requests.at(-1)
            assert.equal(wire?.model, model.slug)
            assert.equal(
              wire?.reasoning?.effort,
              level ?? model.default_reasoning_level,
              `${model.slug}: the default must reach the provider without a manual effort selection`
            )
            assert.equal(wire?.text?.verbosity, undefined, `${model.slug}: unsupported verbosity`)
            assert.equal(wire?.reasoning?.summary, undefined, `${model.slug}: unsupported summary`)
          } else {
            assert.ok(
              session.items.slice(previous).some((item) => item.kind === "tool"),
              `${model.slug}: no terminal tool call`
            )
          }
          replies++
        }
        evidence.push({ model: model.slug, efforts: expected, replies })
        console.log(`PASS ${model.slug}: ${replies} replies; efforts=${expected.join(",") || "hidden"}`)
      }
    }
    const path =
      process.argv.find((arg) => arg.startsWith("--evidence="))?.slice("--evidence=".length) ??
      (live ? "/tmp/alwith-custom-endpoints-live.json" : "/tmp/alwith-custom-fixture-live.json")
    await writeFile(
      path,
      JSON.stringify(
        {
          mode: live ? "configured_endpoints" : "local_responses_fixture",
          evidence,
          requests: fixture
            ? requests.map((request) => ({
                model: request.model,
                reasoning: request.reasoning,
                text: request.text
              }))
            : undefined
        },
        null,
        2
      )
    )
    console.log(`PASS evidence: ${path}`)
  } finally {
    client.disconnect()
  }
} finally {
  await fixture?.stop(true)
}
