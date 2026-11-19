// Reproduce provider initialization after the first native draft, using an isolated login copy.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { startTestRuntime } from "@alwith/api/node"
import { CodexClient, isSelectOption, textOf } from "@alwith/module-chat/client"

import { computerRuntimeEnv } from "../src/features/computer/runtime-config"
import { staged, stagedCodexEngine } from "./lib/runtime"

const authFrom = process.argv.find((argument) => argument.startsWith("--auth-from="))?.slice("--auth-from=".length)
if (!authFrom) throw new Error("Pass --auth-from=<Codex home> to authorize an isolated live check")

await using runtime = await startTestRuntime({
  binary: staged("alwith-runtime"),
  engines: { codex: stagedCodexEngine() },
  authFrom
})
await writeFile(
  resolve(runtime.codexHome, "config.toml"),
  'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "medium"\nservice_tier = "fast"\n'
)
const client = new CodexClient(() => Promise.resolve(runtime.client), {
  agentId: "codex",
  launch: { engine: "codex", env: { ...computerRuntimeEnv, INITIAL_AGENT_MODE: "agent" } }
})
client.setModelSelections({ main: "gpt-6.1-sol", chat: "gpt-6.1-sol" })
const evidence: { phase: string; stop: string | null; reply: string }[] = []

async function reply(id: string, phase: string): Promise<void> {
  const previous = client.session(id).items.length
  await client.prompt(id, [{ type: "text", text: "你好，请只回复：你好。" }])
  const deadline = Date.now() + 90_000
  while (client.session(id).state !== "idle" || client.session(id).items.length === previous) {
    if (Date.now() > deadline) throw new Error(`${phase}: timed out`)
    await Bun.sleep(50)
  }
  const session = client.session(id)
  assert.equal(session.error, null, `${phase}: ${JSON.stringify(session.error)}`)
  assert.equal(session.lastStopReason, "end_turn", `${phase}: turn did not complete`)
  const model = session.configOptions.find((option) => option.category === "model")
  assert.ok(model && isSelectOption(model))
  assert.equal(model.currentValue, "gpt-6.1-sol")
  const text = session.items
    .slice(previous)
    .flatMap((item) => (item.kind === "assistant" ? [textOf(item.content)] : []))
    .join("")
  assert.match(text, /你好/)
  evidence.push({ phase, stop: session.lastStopReason, reply: text })
  console.log(`PASS ${phase}: ${text}`)
}

try {
  await client.connect()
  const draft = await client.prepareDraft("main", runtime.workspace)
  // A later provider registration must not change the existing thread's native model identity.
  await runtime.client.acpRequest("codex", "providers/set", {
    providerId: "openai",
    apiType: "openai",
    baseUrl: "http://127.0.0.1:1/unused",
    _meta: {
      codex: {
        id: "startup-fixture",
        name: "Startup fixture",
        mode: "catalog",
        bearerToken: "unused-test-key",
        config: {
          model_catalog_json: resolve(
            import.meta.dirname,
            "../node_modules/@alwith/module-chat/assets/catalogs/deepseek/models.json"
          )
        }
      },
      alwith: { models: [{ id: "deepseek-flash", label: "DeepSeek" }] }
    }
  })
  await reply(draft, "cold first turn after provider initialization")
  await reply(draft, "second turn in the original session")
  const next = await client.newSession(runtime.workspace)
  await reply(next, "first turn in a new catalog session")
  console.log(JSON.stringify({ model: "gpt-6.1-sol", evidence }))
} finally {
  client.disconnect()
}
