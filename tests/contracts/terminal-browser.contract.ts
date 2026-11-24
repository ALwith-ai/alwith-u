/**
 * Terminals that start while the embedded browser opens a tab. The host has the browser engine
 * loaded, so a terminal's shell must start without copying the host process. Runs on the isolated
 * browser workspace fixture; no agent or user profile is used.
 */
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, afterEach, beforeAll, describe, test } from "vitest"

import { type BrowserTools, conversations, ipc, reportFailure, requireBrowserFixture, waitFor } from "./lib/app"

const ROUNDS = 6
const TERMINALS = 4
const sessionId = `terminal-browser-contract-${crypto.randomUUID()}`
const call = <T>(method: string, params: Record<string, unknown> = {}) =>
  ipc("plugin:alwith-terminal|request", { method, params: { sessionId, ...params } }) as Promise<T>
type Snapshot = { state: string; text: string; exitCode: number | null; error: string | null }

describe("terminals beside the embedded browser", () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new Response(`<title>Round ${new URL(request.url).pathname.slice(1)}</title><body>ready</body>`, {
        headers: { "Content-Type": "text/html" }
      })
  })
  const origin = `http://127.0.0.1:${server.port}`
  const talks = conversations("terminal-browser-contract")
  const targets: string[] = []
  let browser: BrowserTools
  let cwd: string

  beforeAll(async () => {
    await ipc("plugin:window|show", { label: "main" })
    await requireBrowserFixture()
    browser = await talks.agent()
    cwd = await mkdtemp(join(tmpdir(), "alwith-terminal-browser-"))
  })

  afterEach(reportFailure)

  afterAll(async () => {
    await call("closeSession").catch(() => {})
    await talks.close()
    for (const label of targets) await ipc("cef_close_guest", { label }).catch(() => {})
    await server.stop(true)
    await rm(cwd, { recursive: true, force: true })
  })

  test("every terminal started while a tab opens runs its shell to the end", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const ids = Array.from({ length: TERMINALS }, (_, index) => `round-${round}-${index}`)
      const [tab] = await Promise.all([
        browser("browser_open", { url: `${origin}/${round}` }),
        ...ids.map((terminalId, index) =>
          call("start", {
            terminalId,
            cwd,
            shell: "/bin/sh",
            interactive: false,
            // A shell without a controlling terminal cannot open /dev/tty.
            command: `(: </dev/tty) && printf 'mark-%s\\n' ${terminalId}; exit ${index}`
          })
        )
      ])
      targets.push(tab.target)
      for (const [index, terminalId] of ids.entries()) {
        const done = await waitFor(async () => {
          const snapshot = await call<Snapshot>("snapshot", { terminalId })
          return snapshot.state === "exited" || snapshot.state === "failed" ? snapshot : undefined
        }, `${terminalId} did not end`)
        assert.ok(done)
        assert.equal(done.state, "exited", `${terminalId}: ${done.error}`)
        assert.equal(done.exitCode, index, terminalId)
        assert.ok(done.text.includes(`mark-${terminalId}`), `${terminalId} printed ${JSON.stringify(done.text)}`)
      }
      // The tab that opened meanwhile is a live page.
      const title = await browser("browser_evaluate", { target: tab.target, expression: "document.title" })
      assert.equal(title.result, `Round ${round}`)
    }
  })

  test("a terminal serves a page the browser then loads", async () => {
    const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") })
    const port = probe.port
    await probe.stop(true)
    await call("start", {
      terminalId: "server",
      cwd,
      shell: "/bin/sh",
      interactive: false,
      command: `python3 -m http.server ${port} --bind 127.0.0.1`
    })
    await waitFor(
      () =>
        fetch(`http://127.0.0.1:${port}/`).then(
          (response) => response.ok,
          () => false
        ),
      "the terminal's server did not start"
    )
    const tab = await browser("browser_open", { url: `http://127.0.0.1:${port}/` })
    targets.push(tab.target)
    const title = await browser("browser_evaluate", { target: tab.target, expression: "document.title" })
    assert.match(String(title.result), /Directory listing/)
    await call("stop", { terminalId: "server", generation: 1 })
  })
})
