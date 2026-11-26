/** A page that never answers, or a script that never ends, costs one call its time and leaves the tab usable. */
import assert from "node:assert/strict"

import { afterAll, afterEach, beforeAll, describe, test } from "vitest"

import { type BrowserTools, conversations, ipc, reportFailure, requireBrowserFixture } from "./lib/app"

describe("pages and scripts that never answer", () => {
  // Requests for /held are kept open and never answered, as a stalled website keeps them.
  const held = new Set<() => void>()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (path === "/held") return new Promise<Response>((resolve) => held.add(() => resolve(new Response("late"))))
      return new Response(
        `<title>Here ${path.slice(1)}</title><h1>Here</h1><a id="held" href="/held">A held page</a>`,
        {
          headers: { "Content-Type": "text/html" }
        }
      )
    }
  })
  const origin = `http://127.0.0.1:${server.port}`
  const talks = conversations("held-pages-contract")
  let run: BrowserTools
  let target: string
  const shown = async () => (await run("browser_evaluate", { target, expression: "document.title" })).result
  const elapsed = async (work: () => Promise<unknown>) => {
    const started = performance.now()
    await work()
    return performance.now() - started
  }

  beforeAll(async () => {
    await ipc("plugin:window|show", { label: "main" })
    await requireBrowserFixture()
    run = await talks.agent()
    target = (await run("browser_open", { url: `${origin}/a` })).target
  })
  afterEach(reportFailure)
  afterAll(async () => {
    for (const answer of held) answer()
    await run("browser_close", { target }).catch(() => {})
    await talks.close()
    await server.stop(true)
  })

  test("a navigation that does not arrive is stopped, and the tab stays on its page", async () => {
    await assert.rejects(
      run("browser_navigate", { target, url: `${origin}/held` }),
      /did not arrive in time and the navigation was stopped; the tab still shows .*\/a$/
    )
    // Not held any more: the next call answers at once instead of running out of time in its turn.
    assert.ok((await elapsed(async () => assert.equal(await shown(), "Here a"))) < 2000)
    assert.match((await run("browser_snapshot", { target })).text, /heading "Here"/)
  })

  test("a followed link that does not arrive holds one call, which stops it and says so", async () => {
    await assert.rejects(
      run("browser_click", { target, selector: "#held" }),
      /on its way to .*\/held, which has not arrived.*navigation was stopped.*still shows .*\/a\./
    )
    assert.ok((await elapsed(async () => assert.equal(await shown(), "Here a"))) < 2000)
    await run("browser_navigate", { target, url: `${origin}/b` })
    assert.equal(await shown(), "Here b")
  })

  test("a script that never ends is stopped, and the tab answers again", async () => {
    await assert.rejects(
      run("browser_evaluate", { target, expression: "(() => { for (;;) {} })()" }),
      /did not finish in 30 seconds and was stopped/
    )
    assert.ok((await elapsed(async () => assert.equal(await shown(), "Here b"))) < 2000)
    await run("browser_click", { target, selector: "h1" })
  })
})
