#!/usr/bin/env bun
// Exercise authentication loss only in the test helper's disposable Codex home.
import assert from "node:assert/strict"
import { copyFile, unlink } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import { startTestRuntime } from "@alwith/api/node"
import { isText, type Session } from "@alwith/module-chat/client"

import { CodexClient } from "../src/agent/client"
import { isAuthenticationRequired } from "../src/core/request-error"
import { staged, stagedCodexEngine } from "./lib/runtime"

async function until(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 90_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`)
    await Bun.sleep(50)
  }
}

function assistantText(session: Session): string {
  return session.items
    .flatMap((item) => (item.kind === "assistant" ? item.content : []))
    .filter(isText)
    .map((block) => block.text)
    .join("")
}

const authFrom = process.env.CODEX_HOME ?? join(homedir(), ".codex")
await using runtime = await startTestRuntime({
  binary: staged("alwith-runtime"),
  engines: { codex: stagedCodexEngine() },
  authFrom
})
const client = new CodexClient(() => Promise.resolve(runtime.client), {
  agentId: "codex",
  launch: { engine: "codex", env: { INITIAL_AGENT_MODE: "read-only" } }
})
async function restart(): Promise<void> {
  await runtime.client.stop("codex")
  await until(() => client.state.connection === "disconnected", "agent exit")
  await client.connect()
}
try {
  await client.connect()
  const id = await client.newSession(runtime.workspace)
  await client.prompt(id, [{ type: "text", text: "Reply only AUTH_BEFORE_RECONNECT. Do not use tools." }])
  await until(
    () => client.session(id).state === "idle" && assistantText(client.session(id)).includes("AUTH_BEFORE_RECONNECT"),
    "initial reply"
  )
  await unlink(join(runtime.codexHome, "auth.json"))
  await restart()
  await client.open(id, runtime.workspace)
  assert.equal(isAuthenticationRequired(client.session(id).error?.error), true)
  assert.equal(client.session(id).attached, false)
  assert.equal(client.session(id).readOnly, false)
  assert.ok(assistantText(client.session(id)).includes("AUTH_BEFORE_RECONNECT"))

  // Codex accepts API-key login locally. This test key never sends a model request.
  await client.login("api-key", { "api-key": { apiKey: "sk-auth-recovery-local-probe" } })
  await client.open(id, runtime.workspace)
  assert.equal(client.session(id).attached, true)
  assert.equal(client.session(id).error, null)
  assert.equal(client.session(id).items.filter((item) => item.kind === "user").length, 1)
  assert.ok(assistantText(client.session(id)).includes("AUTH_BEFORE_RECONNECT"))

  // Restore the isolated copy of the real login before verifying a subsequent model turn.
  await copyFile(join(authFrom, "auth.json"), join(runtime.codexHome, "auth.json"))
  await restart()
  await client.open(id, runtime.workspace)
  await client.prompt(id, [{ type: "text", text: "Reply only AUTH_AFTER_RECONNECT. Do not use tools." }])
  await until(
    () => client.session(id).state === "idle" && assistantText(client.session(id)).includes("AUTH_AFTER_RECONNECT"),
    "reply after authentication recovery"
  )
  assert.equal(client.session(id).items.filter((item) => item.kind === "user").length, 2)
  console.log(
    "PASS: authentication loss preserves history; login reopens the same conversation without replaying a prompt; a subsequent real turn completes"
  )
} finally {
  client.disconnect()
}
