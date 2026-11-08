// Live verification of prompt suggestions through the packaged Runtime and ACP adapter.
import { mkdtemp, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ProcessRuntimeClient } from "@alwith/api/node"
import { promptSuggestion } from "@alwith/module-chat/client"

import { CodexClient } from "../src/agent/client"
import { staged, stagedCodexEngine } from "./lib/runtime"

const cwd = await realpath(await mkdtemp(join(tmpdir(), "alwith-predictions-")))
function createClient() {
  const port = new ProcessRuntimeClient({
    binary: staged("alwith-runtime"),
    engines: { codex: stagedCodexEngine() },
    journalRoot: join(cwd, "journal"),
    env: { ALWITH_RUNTIME_ATTENTION: join(cwd, "attention") }
  })
  const client = new CodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: { engine: "codex", env: { INITIAL_AGENT_MODE: "read-only" } }
  })
  return { port, client }
}
let { port, client } = createClient()
async function stop() {
  client.disconnect()
  const exited = new Promise<void>((resolve) => port.onProcessExit(() => resolve()))
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
  await client.listSessions({ reset: true })
  const project = await client.listProjectSessions(cwd)
  const parentVisible = project.some((sessionRow) => sessionRow.sessionId === sessionId)
  const temporaryVisible = project.some((sessionRow) => sessionRow.sessionId !== sessionId)
  evidence.push({ phase, parentVisible, temporaryVisible })
  if (!parentVisible || temporaryVisible) throw new Error(`Sidebar isolation failed: ${phase}`)
  console.log(`Sidebar ${phase}: parent visible; no temporary session`)
}
try {
  await client.connect()
  sessionId = await client.newSession(cwd)
  const id = sessionId
  const leakedSessions = new Set<string>()
  unsubscribe = client.store.subscribe((state) => {
    for (const key of Object.keys(state.sessions)) if (key !== id) leakedSessions.add(key)
  })
  await client.prompt(id, [
    {
      type: "text",
      text: "I need unit tests for a calculator's addition function. Reply with a brief next step. Do not use tools."
    }
  ])
  await until(() => client.session(id).state === "idle", "reply")
  const session = client.session(id)
  if (session.lastStopReason !== "end_turn") throw new Error("No successful source turn")
  const count = session.items.length
  // The adapter samples the session thread after the completed turn and publishes the suggestion itself.
  await until(() => promptSuggestion(client.session(id)._meta) !== null, "prompt suggestion")
  const suggestion = promptSuggestion(client.session(id)._meta)
  if (client.session(id).state !== "idle" || client.session(id).items.length !== count)
    throw new Error("Prompt suggestion mutated the conversation")
  if (leakedSessions.size) throw new Error("Suggestion sampling leaked a session into UI state")
  await snapshot("suggested")
  unsubscribe()
  unsubscribe = undefined
  await stop()
  ;({ port, client } = createClient())
  await client.connect()
  await snapshot("restarted")
  await writeFile(
    join(cwd, "evidence.json"),
    JSON.stringify({ evidence, suggestion, transcriptUnchanged: true, leakedSessionCount: leakedSessions.size }, null, 2)
  )
  console.log(`Prompt suggestion received; transcript unchanged; evidence: ${join(cwd, "evidence.json")}`)
} finally {
  unsubscribe?.()
  if (sessionId) await client.delete(sessionId)
  await stop()
}
