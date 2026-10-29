// Read the verification credential from stdin; never save it in app preferences or evidence.
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { ProcessRuntimeClient } from "@alwith/api/node"
import { isGroupedSelect, isSelectOption } from "@nyssance/codex-acp-v2/client"

import { CodexClient } from "../src/agent/client"
import { staged, stagedCodexEngine } from "./lib/runtime"

const key = (await Bun.stdin.text()).trim()
if (!key) throw new Error("Provide a verification credential on stdin")
const isolated = process.argv.includes("--no-chatgpt")
const cwd = await realpath(await mkdtemp(join(tmpdir(), "alwith-provider-routing-")))
await mkdir(join(cwd, "codex"))
const gateway = "gateway:deepseek:deepseek-flash"
const evidence: { phase: string; model: string | null; stopReason: string | null }[] = []
const ids: string[] = []
function createClient() {
  const port = new ProcessRuntimeClient({
    binary: staged("alwith-runtime"),
    engines: { codex: stagedCodexEngine() },
    journalRoot: join(cwd, "journal"),
    env: { ALWITH_RUNTIME_ATTENTION: join(cwd, "attention") }
  })
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: {
      engine: "codex",
      env: { INITIAL_AGENT_MODE: "workspace-write", ...(isolated ? { CODEX_HOME: join(cwd, "codex") } : {}) }
    }
  })
  client.setModelSelections({ main: gateway, chat: gateway })
  return { port, client }
}
let { port, client } = createClient()
async function stop() {
  client.disconnect()
  const exited = new Promise<void>((done) => port.onProcessExit(() => done()))
  port.close()
  await exited
}
async function configure() {
  await client.connect()
  await port.acpRequest("codex", "providers/set", {
    providerId: "openai",
    apiType: "openai",
    baseUrl: "https://api.deepseek.com/",
    _meta: {
      codex: {
        id: "deepseek",
        name: "DeepSeek",
        mode: "catalog",
        bearerToken: key,
        config: {
          web_search: "disabled",
          model_catalog_json: resolve(import.meta.dirname, "../src-tauri/resources/deepseek/models.json")
        }
      },
      alwith: { models: [{ id: "deepseek-flash", label: "DeepSeek" }] }
    }
  })
}
async function reply(id: string, phase: string) {
  await client.prompt(id, [
    { type: "text", text: "Reply with exactly PROVIDER_OK and nothing else. Do not use tools." }
  ])
  const deadline = Date.now() + 120_000
  while (client.session(id).state !== "idle") {
    if (Date.now() > deadline) throw new Error(`${phase}: reply timed out`)
    await Bun.sleep(50)
  }
  const session = client.session(id)
  const model = session.configOptions.find((option) => option.category === "model")?.currentValue
  evidence.push({ phase, model: typeof model === "string" ? model : null, stopReason: session.lastStopReason })
  console.log(`${phase}: ${String(model)}; ${session.lastStopReason}`)
  if (session.lastStopReason !== "end_turn") throw new Error(`${phase}: ${JSON.stringify(session.error)}`)
}
try {
  await configure()
  const first = await client.newSession(cwd, gateway)
  ids.push(first)
  await reply(first, isolated ? "DeepSeek without ChatGPT login" : "DeepSeek direct")
  if (!isolated) {
    const model = client.session(first).configOptions.find((option) => option.category === "model")
    if (!model || !isSelectOption(model) || !isGroupedSelect(model.options)) throw new Error("Missing model groups")
    const native = model.options.find((group) => group.groupId === "chatgpt")?.options[0]?.value
    if (!native) throw new Error("Missing native model")
    const id = await client.newSession(cwd, native)
    ids.push(id)
    await reply(id, "GPT source turn")
    for (const [index, target] of [gateway, native, gateway].entries()) {
      await client.setConfig(id, "model", target)
      await reply(id, `Switch ${index + 1}`)
    }
  }
  await stop()
  ;({ port, client } = createClient())
  await configure()
  await client.open(first, cwd)
  await reply(first, "DeepSeek after Runtime restart")
  await writeFile(join(cwd, "evidence.json"), JSON.stringify({ isolated, evidence }, null, 2))
  console.log(`PASS: evidence ${join(cwd, "evidence.json")}`)
} catch (error) {
  const data = (error as { data?: unknown })?.data
  console.error(JSON.stringify({ message: String(error), data }).replaceAll(key, "[redacted]"))
  process.exitCode = 1
} finally {
  try {
    for (const id of ids) await client.delete(id)
  } finally {
    await stop()
  }
}
