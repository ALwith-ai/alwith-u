// Headless check of the story wiring: the staged Runtime loads the story module from node_modules,
// resolves a dsh launch through `agent/launch`, U-style app-owned agent start, one prompt, then the
// ledger must hold that prompt with its session provenance. Without DEEPSEEK_API_KEY the model call
// fails and the check still passes: the mirror runs before the model answers. With a key it runs two
// real turns and `/compact`, and also requires prose in the ledger and a note whose sources are
// ledger entries. The module is taken from ALWITH_MODULES_DIR (default: this checkout's node_modules).
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
  env: {
    ALWITH_MODULES_DIR: process.env.ALWITH_MODULES_DIR ?? join(root_dir, "node_modules"),
    ALWITH_DSH_SESSIONS_ROOT: join(scratch, "sessions")
  },
  stderr: "ignore"
})
const watchdog = setTimeout(() => {
  console.error("story smoke timed out")
  port.kill()
  process.exit(2)
}, 600_000)
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
  const live = process.env.DEEPSEEK_API_KEY !== undefined
  const idle: Array<() => void> = []
  agent.onNotification((method, params) => {
    const update = (params as { sessionId?: string; update?: { sessionUpdate?: string; state?: string } }).update
    if (method === "session/update" && update?.sessionUpdate === "state_update" && update.state === "idle")
      idle.shift()?.()
  })
  /** ACP v2: the prompt response is acceptance; the turn ends with a running → idle state_update. */
  const turn = async (text: string): Promise<string> => {
    const ended = new Promise<void>(resolve => idle.push(resolve))
    try {
      await agent.request("session/prompt", { sessionId, prompt: [{ type: "text", text }] })
    } catch (error) {
      idle.pop()
      return `model call failed: ${String(error).split("\n")[0]}`
    }
    await ended
    return "answered"
  }
  const text = "Open with one sentence about the fog."
  const outcome = await turn(text)
  if (live) {
    assert.equal(outcome, "answered", "the model answers when a key is present")
    assert.equal(await turn("Continue with one sentence about a ship arriving."), "answered")
    assert.equal(await turn("/compact"), "answered")
  }
  await new Promise(resolve => setTimeout(resolve, 1500))
  type Entry = { seq: number; kind: string; text: string; source?: { sessionId: string } }
  const ledger = await call<Entry[]>("ledger/read", {})
  const input = ledger.find(entry => entry.kind === "input")
  assert.ok(
    input !== undefined && input.text === text && input.source?.sessionId === sessionId,
    "prompt mirrored into the ledger with its session"
  )
  assert.ok(changed.includes("ledger"), "ledger change broadcast as a module event")
  const notes = await call<Array<{ sourceSeqs: number[]; text: string }>>("note/list", {})
  if (live) {
    assert.ok(ledger.filter(entry => entry.kind === "prose").length >= 2, "both answers mirrored as prose")
    assert.ok(notes.length >= 1, "the compaction summary became a note")
    const seqs = new Set(ledger.map(entry => entry.seq))
    assert.ok(
      notes[0].sourceSeqs.length > 0 && notes[0].sourceSeqs.every(seq => seqs.has(seq)),
      "note sources are ledger entries"
    )
  }
  await agent.stop()
  console.log(
    JSON.stringify({
      ok: true,
      live,
      outcome,
      ledger: ledger.map(entry => `${entry.seq}:${entry.kind}`),
      notes: notes.map(note => ({ sources: note.sourceSeqs, chars: note.text.length }))
    })
  )
} finally {
  clearTimeout(watchdog)
  port.close()
}
