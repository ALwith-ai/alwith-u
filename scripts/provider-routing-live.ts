// Read the verification credential from stdin; never save it in app preferences or evidence.
import { cp, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { isGroupedSelect, isSelectOption } from "@nyssance/codex-acp-v2/client"
import { ProcessRuntimeClient, startTestRuntime } from "@alwith/api/node"

import { CodexClient } from "../src/agent/client"
import { staged, stagedCodexEngine } from "./lib/runtime"

const key = (await Bun.stdin.text()).trim()
if (!key) throw new Error("Provide a verification credential on stdin")
const isolated = process.argv.includes("--no-chatgpt")
const cwd = await realpath(await mkdtemp(join(tmpdir(), "alwith-provider-routing-")))
const authFrom = process.argv.find((value) => value.startsWith("--auth-from="))?.slice("--auth-from=".length)
if (!isolated && !authFrom) throw new Error("Pass --auth-from=<Codex home> explicitly or use --no-chatgpt")
const savedHome = join(cwd, "restart-home")
const gateway = "gateway:deepseek:deepseek-flash"
const evidence: { phase: string; model: string | null; stopReason: string | null }[] = []
const ids: string[] = []
async function createClient(resume = false) {
  const runtime = await startTestRuntime({
    binary: staged("alwith-runtime"),
    engines: { codex: stagedCodexEngine() },
    authFrom: isolated ? undefined : authFrom
  })
  const port = runtime.client
  if (!(port instanceof ProcessRuntimeClient)) { await runtime.dispose(); throw new Error("Expected stdio Runtime") }
  let resolveExit!: () => void
  const exited = new Promise<void>((done) => { resolveExit = done })
  port.onProcessExit(() => resolveExit())
  if (resume) {
    try { await cp(savedHome, runtime.codexHome, { recursive: true }) }
    catch (error) { await runtime.dispose(); throw error }
  }
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: {
      engine: "codex",
      env: { INITIAL_AGENT_MODE: "workspace-write" }
    }
  })
  client.setModelSelections({ main: gateway, chat: gateway })
  return { port, client, runtime, exited }
}
let { port, client, runtime, exited } = await createClient()
async function stop(preserve = false) {
  client.disconnect()
  try {
    port.close()
    await exited
    if (preserve) await cp(runtime.codexHome, savedHome, { recursive: true })
  } finally { await runtime.dispose() }
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
  await stop(true)
  ;({ port, client, runtime, exited } = await createClient(true))
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
    try { await stop() } finally { await rm(savedHome, { recursive: true, force: true }) }
  }
}
