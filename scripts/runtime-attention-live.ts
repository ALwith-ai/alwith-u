// Demonstrate shared attention-file resurrection, then verify isolated host storage.
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ProcessRuntimeClient } from "@alwith/api/node"

import { CodexClient } from "../src/agent/client"
import { staged, stagedCodexEngine } from "./lib/runtime"

const cwd = await realpath(await mkdtemp(join(tmpdir(), "alwith-attention-check-")))
function port(label: string, attention: string) {
  return new ProcessRuntimeClient({
    binary: staged("alwith-runtime"),
    engines: { codex: stagedCodexEngine() },
    journalRoot: join(cwd, label, "journal"),
    env: { ALWITH_RUNTIME_ATTENTION: attention }
  })
}
async function close(runtime: ProcessRuntimeClient, client?: CodexClient) {
  client?.disconnect()
  const exited = new Promise<void>((resolve) => runtime.onProcessExit(() => resolve()))
  runtime.close()
  await exited
}
async function check(shared: boolean) {
  const root = join(cwd, shared ? "shared" : "isolated")
  const attention = join(root, "host-a")
  const seed = port("seed", attention)
  const first = new CodexClient(() => Promise.resolve(seed), {
    agentId: "codex",
    launch: { engine: "codex" }
  })
  await first.connect()
  const id = await first.newSession(cwd)
  await first.prompt(id, [{ type: "text", text: "Reply with exactly ATTENTION_OK. Do not use tools." }])
  const deadline = Date.now() + 120_000
  while (first.session(id).state !== "idle") {
    if (Date.now() > deadline) throw new Error("Source reply timed out")
    await Bun.sleep(50)
  }
  await close(seed, first)
  const owner = port("owner", attention)
  const other = port("other", shared ? attention : join(root, "host-b"))
  // Recover both snapshots before starting an agent, so neither can reclaim its peer's process.
  await owner.runStates()
  const foreign = (await other.runStates()).some((state) => state.sessionId === id)
  const client = new CodexClient(() => Promise.resolve(owner), { agentId: "codex", launch: { engine: "codex" } })
  await client.connect()
  try {
    await client.stopSession(id)
    if ((await owner.runStates()).some((state) => state.sessionId === id)) throw new Error("Close failed")
    await other.setSessionTitle(id, "Another Runtime updated its snapshot")
    await close(other)
    const restarted = port("restarted", attention)
    const resurrected = (await restarted.runStates()).some((state) => state.sessionId === id)
    await close(restarted)
    console.log(JSON.stringify({ shared, foreign, resurrected }))
    if (foreign !== shared || resurrected !== shared) throw new Error("Unexpected storage isolation result")
  } finally {
    await client.delete(id)
    await close(owner, client)
  }
}
async function checkProcessLease(shared: boolean) {
  const root = join(cwd, shared ? "shared-leases" : "isolated-leases")
  const owner = port("lease-owner", join(root, "host-a"))
  const client = new CodexClient(() => Promise.resolve(owner), { agentId: "codex", launch: { engine: "codex" } })
  await client.connect()
  const other = port("lease-other", join(root, shared ? "host-a" : "host-b"))
  try {
    await other.runStates()
    const deadline = Date.now() + 3000
    let alive = (await owner.agents()).some((agent) => agent.agentId === "codex")
    while (shared && alive && Date.now() < deadline) {
      await Bun.sleep(50)
      alive = (await owner.agents()).some((agent) => agent.agentId === "codex")
    }
    console.log(JSON.stringify({ sharedLeases: shared, agentSurvivedOtherStartup: alive }))
    if (!alive) throw new Error("Another host reclaimed a live peer process")
  } finally {
    await close(other)
    await close(owner, client)
  }
}
await check(true)
await check(false)
await checkProcessLease(true)
await checkProcessLease(false)
console.log("PASS: isolated host storage prevents activity resurrection and leaves live peer agents running")
