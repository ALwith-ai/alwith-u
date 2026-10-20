// Live verification of predictions through the packaged Runtime and ACP adapter.
import { mkdtemp, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ProcessRuntimeClient } from "@alwith/api/node"

import { CodexClient } from "../src/agent/client"
import { codexTurnId, composerPrediction } from "../src/agent/codex-extensions"
import { staged, stagedCodexEngine } from "./lib/runtime"

const cwd = await realpath(await mkdtemp(join(tmpdir(), "alwith-predictions-")))
function createClient() {
  const port = new ProcessRuntimeClient({
    binary: staged("alwith-runtime"),
    engines: { codex: stagedCodexEngine() },
    journalRoot: join(cwd, "journal")
  })
  const client = new CodexClient(async () => port, {
    agentId: "codex",
    launch: { engine: "codex", env: { INITIAL_AGENT_MODE: "read-only" } }
  })
  return { port, client }
}
let { port, client } = createClient()
async function stop() {
  client.disconnect()
  const exited = new Promise<void>(resolve => port.onProcessExit(() => resolve()))
  port.close()
  await exited
}
async function until(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 120_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`)
    await Bun.sleep(50)
  }
}
let sessionId: string | undefined
let unsubscribe: (() => void) | undefined
const evidence: { phase: string; parentVisible: boolean; temporaryVisible: boolean }[] = []
async function snapshot(phase: string) {
  await client.listThreads({ reset: true })
  const project = await client.listProjectThreads(cwd)
  const parentVisible = project.some(thread => thread.sessionId === sessionId)
  const temporaryVisible = project.some(thread => thread.sessionId !== sessionId)
  evidence.push({ phase, parentVisible, temporaryVisible })
  if (!parentVisible || temporaryVisible) throw new Error(`Sidebar isolation failed: ${phase}`)
  console.log(`Sidebar ${phase}: parent visible; no temporary fork`)
}
try {
  await client.connect()
  sessionId = await client.newSession(cwd)
  const id = sessionId
  await client.prompt(id, [
    {
      type: "text",
      text: "I need unit tests for a calculator's addition function. Reply with a brief next step. Do not use tools."
    }
  ])
  await until(() => client.session(id).state === "idle", "reply")
  const session = client.session(id)
  const sourceTurnId = codexTurnId(session.items.findLast(item => item.kind === "user")?._meta)
  if (!sourceTurnId || session.lastStopReason !== "end_turn") throw new Error("No successful source turn")
  const count = session.items.length
  const leakedSessions = new Set<string>()
  unsubscribe = client.store.subscribe(state => {
    for (const key of Object.keys(state.sessions)) if (key !== id) leakedSessions.add(key)
  })
  await client.requestPrediction(id, sourceTurnId)
  if (composerPrediction(client.session(id)._meta)) throw new Error("Prediction finished before the running snapshot")
  await snapshot("generating")
  await until(() => composerPrediction(client.session(id)._meta)?.sourceTurnId === sourceTurnId, "prediction")
  const prediction = composerPrediction(client.session(id)._meta)
  if (!prediction || prediction.result.type !== "completed") throw new Error("Codex prediction generation failed")
  if (client.session(id).state !== "idle" || client.session(id).items.length !== count)
    throw new Error("Prediction mutated the conversation")
  if (leakedSessions.size) throw new Error("Temporary fork events entered UI session state")
  await snapshot("generated")
  unsubscribe()
  unsubscribe = undefined
  await stop()
  ;({ port, client } = createClient())
  await client.connect()
  await snapshot("restarted")
  await writeFile(
    join(cwd, "evidence.json"),
    JSON.stringify({ evidence, transcriptUnchanged: true, leakedSessionCount: leakedSessions.size }, null, 2)
  )
  console.log(`Prediction completed; transcript unchanged; evidence: ${join(cwd, "evidence.json")}`)
} finally {
  unsubscribe?.()
  if (sessionId) await client.delete(sessionId)
  await stop()
}
