// Verify that closing a recovered activity retires its persisted Runtime record.
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ProcessRuntimeClient } from "@alwith/api/node"

import { CodexClient } from "../src/agent/client"
import { staged, stagedCodexEngine } from "./lib/runtime"

const cwd = await realpath(await mkdtemp(join(tmpdir(), "alwith-close-check-")))
function connectClient() {
  const port = new ProcessRuntimeClient({
    binary: staged("alwith-runtime"),
    engines: { codex: stagedCodexEngine() },
    journalRoot: join(cwd, "journal"),
    env: { ALWITH_RUNTIME_ATTENTION: join(cwd, "attention") }
  })
  return {
    port,
    client: new CodexClient(() => Promise.resolve(port), {
      agentId: "codex",
      launch: { engine: "codex", env: { INITIAL_AGENT_MODE: "read-only" } }
    })
  }
}
let { port, client } = connectClient()
async function stop() {
  client.disconnect()
  const exited = new Promise<void>((resolve) => port.onProcessExit(() => resolve()))
  port.close()
  await exited
}
let id: string | undefined
let running: string | undefined
try {
  await client.connect()
  id = await client.newSession(cwd)
  await client.prompt(id, [{ type: "text", text: "Reply with exactly CLOSE_CHECK. Do not use tools." }])
  const deadline = Date.now() + 120_000
  while (client.session(id).state !== "idle") {
    if (Date.now() > deadline) throw new Error("Reply timed out")
    await Bun.sleep(50)
  }
  if (client.session(id).lastStopReason !== "end_turn") throw new Error("Source turn did not complete")
  await stop()
  ;({ port, client } = connectClient())
  await client.connect()
  if (!(await port.runStates()).some((state) => state.sessionId === id)) throw new Error("No recovered activity")
  await client.stopSession(id)
  if ((await port.runStates()).some((state) => state.sessionId === id)) throw new Error("Closed activity remains")
  running = await client.newSession(cwd)
  await client.prompt(running, [
    { type: "text", text: "Count from 1 to 10000, one number per line. Do not use tools." }
  ])
  await client.stopSession(running)
  if ((await port.runStates()).some((state) => state.sessionId === running))
    throw new Error("Running activity remains after close")
  await stop()
  ;({ port, client } = connectClient())
  await client.connect()
  if ((await port.runStates()).some((state) => state.sessionId === id || state.sessionId === running))
    throw new Error("Closed activity returned after restart")
  console.log("PASS: recovered and running activities close; remain absent after restart")
} finally {
  if (id) await client.delete(id)
  if (running) await client.delete(running)
  await stop()
}
