// Headless check of the story wiring: the staged Runtime loads the story module from node_modules,
// resolves a dsh launch through `agent/launch`, U-style app-owned agent start, one prompt, then the
// ledger must hold that prompt with its session provenance. Without DEEPSEEK_API_KEY the model call
// fails and the check still passes: the mirror runs before the model answers.
//   ALWITH_U_DSH_AGENT=../dsh-agent/src/main.ts bun scripts/story-smoke.ts
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Agent } from "@alwith/api"
import { ProcessRuntimeClient } from "@alwith/api/node"

const root_dir = resolve(import.meta.dirname, "..")
const dshAgent = process.env.ALWITH_U_DSH_AGENT
if (dshAgent === undefined)
  throw new Error("ALWITH_U_DSH_AGENT must name the dsh-agent entry (…/dsh-agent/src/main.ts)")
const scratch = mkdtempSync(join(tmpdir(), "story-smoke-"))
const root = join(scratch, "story")
const port = new ProcessRuntimeClient({
  binary: join(root_dir, "src-tauri/binaries/alwith-runtime-aarch64-apple-darwin"),
  engines: { dsh: { command: process.execPath, args: [resolve(dshAgent)] } },
  journalRoot: join(scratch, "journal"),
  env: { ALWITH_MODULES_DIR: join(root_dir, "node_modules"), ALWITH_DSH_SESSIONS_ROOT: join(scratch, "sessions") },
  stderr: "ignore"
})
const watchdog = setTimeout(() => {
  console.error("story smoke timed out")
  port.kill()
  process.exit(2)
}, 90_000)
try {
  const modules = await port.request<Array<{ name: string; alive: boolean }>>("modules")
  assert.ok(
    modules.some(module => module.name === "alwith-story" && module.alive),
    "story module alive"
  )
  const call = <T>(method: string, params: Record<string, unknown>) =>
    port.request<T>(`modules/alwith-story/${method}`, { root, ...params })
  const opened = await call<{ revision: number }>("open", {})
  await call("frame/set", {
    sections: [{ key: "world", text: "A harbour town in perpetual fog." }],
    expectedRevision: opened.revision
  })
  const changed: string[] = []
  port.onModuleEvent("alwith-story", event => {
    if (event.type === "changed") changed.push(String(event.what))
  })
  const { launch } = await call<{ launch: { env: Record<string, string> } }>("agent/launch", {
    launch: {
      engine: "dsh",
      cwd: root,
      env: { ALWITH_DSH_WORKSPACE_ROOT: root, ALWITH_DSH_PERMISSION_MODE: "read-only" }
    }
  })
  assert.ok(launch.env.ALWITH_DSH_PRESET.endsWith("/dsh-preset"), "bundled preset applied")
  assert.equal(launch.env.ALWITH_STORY_ROOT, root)
  const agentId = `story-${crypto.randomUUID()}`
  await port.start(agentId, launch)
  const initialized = await port.acpRequest(agentId, "initialize", {
    protocolVersion: 2,
    info: { name: "story-smoke", version: "0" },
    capabilities: {}
  })
  const agent = new Agent(port, agentId, "dsh", initialized)
  await agent.listen()
  const { sessionId } = await agent.request<{ sessionId: string }>("session/new", { cwd: root, mcpServers: [] })
  const text = "Open with one sentence about the fog."
  const outcome = await agent.request("session/prompt", { sessionId, prompt: [{ type: "text", text }] }).then(
    () => "answered",
    error => `model call failed: ${String(error).split("\n")[0]}`
  )
  await new Promise(resolve => setTimeout(resolve, 1500))
  const ledger = await call<Array<{ kind: string; text: string; source?: { sessionId: string } }>>("ledger/read", {})
  const input = ledger.find(entry => entry.kind === "input")
  assert.ok(
    input !== undefined && input.text === text && input.source?.sessionId === sessionId,
    "prompt mirrored into the ledger with its session"
  )
  assert.ok(changed.includes("ledger"), "ledger change broadcast as a module event")
  await agent.stop()
  console.log(
    JSON.stringify({
      ok: true,
      outcome,
      ledger: ledger.length,
      prose: ledger.filter(entry => entry.kind === "prose").length
    })
  )
} finally {
  clearTimeout(watchdog)
  port.close()
}
