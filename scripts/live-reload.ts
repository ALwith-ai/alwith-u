import { homedir } from "node:os"
import { join } from "node:path"

// Native reload regression: isolated homes and read-only shell commands, without model calls.
import type { RuntimeClient } from "@alwith/api"
import { startTestRuntime } from "@alwith/api/node"

import { CodexClient } from "../src/agent/client"
import { staged, stagedCodexEngine } from "./lib/runtime"

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 45_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
    await Bun.sleep(25)
  }
}

function makeClient(port: RuntimeClient): CodexClient {
  return new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
}

async function check(transport: "stdio" | "ws"): Promise<void> {
  await using runtime = await startTestRuntime({
    binary: staged("alwith-runtime"),
    engines: { codex: stagedCodexEngine() },
    transport,
    authFrom: process.env.CODEX_HOME ?? join(homedir(), ".codex")
  })
  const clients: CodexClient[] = []
  const createClient = () => {
    const client = makeClient(runtime.client)
    clients.push(client)
    return client
  }
  const finished = (client: CodexClient, id: string, marker: string) =>
    client.session(id).state === "idle" &&
    client
      .session(id)
      .items.some(
        (item) => item.kind === "tool" && item.status === "completed" && JSON.stringify(item).includes(marker)
      )
  const command = async (client: CodexClient, id: string, marker: string) => {
    await client.executeShell(id, `echo ${marker}`)
    await until(() => finished(client, id, marker), marker)
  }
  try {
    const first = createClient()
    await first.connect()
    const id = await first.newSession(runtime.workspace)
    await command(first, id, "BEFORE_RELOAD")
    // Adding a catalog changes the process-selection key. The already loaded writer must still win.
    await runtime.client.acpRequest("codex", "providers/set", {
      providerId: "openai",
      apiType: "openai",
      baseUrl: "https://example.invalid/v1",
      _meta: {
        codex: { id: "reload-test", name: "Reload test", mode: "catalog", bearerToken: "isolated-test" },
        alwith: { models: [{ id: "test-model", label: "Test model" }] }
      }
    })
    first.disconnect()
    const second = createClient()
    await second.connect()
    await second.open(id, runtime.workspace)
    if (second.session(id).readOnly || !second.session(id).attached) throw new Error("Reload lost its own writer")
    await command(second, id, "AFTER_IDLE_RELOAD")
    await second.executeShell(id, "sleep 2; echo RUNNING_RELOAD_FINISHED")
    await until(() => second.session(id).state === "running", "running command")
    second.disconnect()
    const third = createClient()
    await third.connect()
    await third.open(id, runtime.workspace)
    if (third.session(id).readOnly) throw new Error("Reload locked its running session")
    await until(() => finished(third, id, "RUNNING_RELOAD_FINISHED"), "completion after running reload")
    await command(third, id, "AFTER_RUNNING_RELOAD")
    await third.close(id)
    console.log(`${transport}: idle and running reloads retain the writer, replay history and continue commands`)
  } finally {
    for (const client of clients) client.disconnect()
  }
}

for (const transport of ["stdio", "ws"] as const) await check(transport)
