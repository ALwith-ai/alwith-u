/** Identical application-terminal contract on CEF and Wry. No agent or user profile is created. */
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, test } from "vitest"

import { ipc, waitFor } from "./lib/app"

const sessionId = `terminal-contract-${crypto.randomUUID()}`
const call = <T>(method: string, params: Record<string, unknown> = {}) =>
  ipc("plugin:alwith-terminal|request", { method, params: { sessionId, ...params } }) as Promise<T>
type Snapshot = { terminalId: string; generation: number; state: string; text: string; viewLease?: string }
describe("application terminals", () => {
  let cwd: string
  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), "alwith-terminal-"))
  })
  afterAll(async () => {
    await call("closeSession")
    await rm(cwd, { recursive: true, force: true })
  })
  test("headless output, identities and view gates do not depend on frontend listeners", async () => {
    const capabilities = await call<{ headless: boolean; interactiveView: boolean }>("capabilities")
    assert.equal(capabilities.headless, true)
    await call("start", { terminalId: "one", cwd, command: "echo terminal-contract-ready", interactive: false })
    await call("start", { terminalId: "two", cwd, interactive: false })
    await waitFor(
      async () => (await call<Snapshot>("snapshot", { terminalId: "one" })).text.includes("terminal-contract-ready"),
      "headless output did not arrive"
    )
    assert.equal((await call<Snapshot[]>("list")).length, 2)
    await assert.rejects(call("snapshot", { sessionId: "another-chat", terminalId: "one" }), /SESSION_MISMATCH/)
    if (capabilities.interactiveView) {
      const attached = await call<Snapshot>("attachView", { terminalId: "one", viewLease: "lease" })
      assert.equal(attached.generation, 1)
      await call("detach", { terminalId: "one", viewLease: "lease" })
      assert.equal((await call<Snapshot>("snapshot", { terminalId: "one" })).state, "running")
    } else {
      await assert.rejects(call("attachView", { terminalId: "one", viewLease: "lease" }), /CAPABILITY_UNSUPPORTED/)
      await assert.rejects(call("register", { terminalId: "view", cwd, interactive: true }), /CAPABILITY_UNSUPPORTED/)
    }
    await call("stop", { terminalId: "one", generation: 1 })
    const restarted = await call<Snapshot>("restart", { terminalId: "one", generation: 1 })
    assert.equal(restarted.generation, 2)
    await assert.rejects(call("write", { terminalId: "one", generation: 1, data: "bad" }), /STALE_GENERATION/)
    await assert.rejects(call("shutdown"), /METHOD_NOT_FOUND/)
  })
})
