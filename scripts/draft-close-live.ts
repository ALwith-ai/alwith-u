// Exercise draft retirement against an isolated Runtime, without shell or history-replay prerequisites.
import { homedir } from "node:os"
import { join } from "node:path"

import { startTestRuntime } from "@alwith/api/node"
import { CodexClient } from "@alwith/module-chat/client"

import { staged, stagedCodexEngine } from "./lib/runtime"

await using runtime = await startTestRuntime({
  binary: staged("alwith-runtime"),
  engines: { codex: stagedCodexEngine() },
  authFrom: process.env.CODEX_HOME ?? join(homedir(), ".codex")
})
const client = new CodexClient(() => Promise.resolve(runtime.client), {
  agentId: "codex",
  launch: { engine: "codex", env: { INITIAL_AGENT_MODE: "read-only" } }
})
async function send(id: string) {
  await client.prompt(id, [{ type: "text", text: "Reply with exactly DRAFT_CLOSE_OK. Do not use tools." }])
  const deadline = Date.now() + 120_000
  while (client.session(id).state !== "idle") {
    if (Date.now() > deadline) throw new Error("Draft close live response timed out")
    await Bun.sleep(50)
  }
  if (client.session(id).lastStopReason !== "end_turn") throw new Error("Draft close live turn did not complete")
}
try {
  await client.connect()
  const used = await client.newSession(runtime.workspace)
  await send(used)
  const drafts = await Promise.all([
    client.prepareDraft("main", runtime.workspace),
    client.prepareDraft("chat", runtime.workspace)
  ])
  for (const id of [used, ...drafts]) await client.stopSession(id)
  if (Object.keys(client.state.draftSessions).length !== 0) throw new Error("A stopped draft retained ownership")
  const states = await runtime.client.runStates()
  if (states.some((state) => [used, ...drafts].includes(state.sessionId)))
    throw new Error(
      `A closed activity remains in Runtime: ${JSON.stringify(states.map(({ sessionId, state, reusableDraft }) => ({ sessionId, state, reusableDraft, draft: drafts.includes(sessionId) })))}`
    )
  await client.discardDraft("main")
  const next = await client.prepareDraft("main", runtime.workspace)
  if (!client.session(next).attached || drafts.includes(next)) throw new Error("The new draft is not writable")
  await send(next)
  console.log("PASS: closing used and unsent activities leaves a fresh writable conversation")
} finally {
  client.disconnect()
}
