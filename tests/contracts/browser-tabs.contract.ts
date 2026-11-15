/** Real browser pane contract: two AI conversations, separate tabs, retained live state. */
import assert from "node:assert/strict"

import { afterAll, afterEach, beforeAll, describe, test } from "vitest"

import { type BrowserTools, conversations, ipc, reportFailure, requireBrowserFixture, ui, waitFor } from "./lib/app"

describe("browser tabs", () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new Response(
        `<title>Tab ${new URL(request.url).pathname.slice(1)}</title><body data-route="${new URL(request.url).pathname}"><label>Draft<input id="draft"></label><button onclick="document.querySelector('#result').textContent='Saved'">Save</button><p id="result"></p>`,
        { headers: { "Content-Type": "text/html" } }
      )
  })
  const origin = `http://127.0.0.1:${server.port}`
  const talks = conversations("tab-contract")
  const targets: string[] = []
  let a: BrowserTools
  let b: BrowserTools
  let one: any
  let two: any
  const draft = async (tools: BrowserTools, target: string) =>
    (await tools("browser_evaluate", { target, expression: "document.querySelector('#draft').value" })).result

  beforeAll(async () => {
    await ipc("plugin:window|show", { label: "main" })
    await requireBrowserFixture()
  })

  afterEach(reportFailure)

  afterAll(async () => {
    await talks.close()
    for (const label of targets) await ipc("cef_close_guest", { label }).catch(() => {})
    await server.stop(true)
  })

  test("two conversations open a tab each at the same time", async () => {
    ;[a, b] = await Promise.all([talks.agent(), talks.agent()])
    ;[one, two] = await Promise.all([
      a("browser_open", { url: `${origin}/A` }),
      b("browser_open", { url: `${origin}/B` })
    ])
    targets.push(one.target, two.target)
    assert.notEqual(one.target, two.target)
  })

  test("each tab keeps what was typed into it, Chinese included", async () => {
    await a("browser_type", { target: one.target, selector: "#draft", text: "AI A draft 中文", replace: true })
    await b("browser_type", { target: two.target, selector: "#draft", text: "AI B draft", replace: true })
    assert.equal(await draft(a, one.target), "AI A draft 中文")
    assert.equal(await draft(b, two.target), "AI B draft")
  })

  test("a conversation neither sees nor reaches another conversation's tab", async () => {
    assert.ok(!(await a("browser_list")).targets.some((target: any) => target.id === two.target))
    await assert.rejects(a("browser_read_page", { target: two.target }), /403/)
    await assert.rejects(
      b("browser_cdp", { target: one.target, method: "Runtime.evaluate", params: { expression: "document.title" } }),
      /403/
    )
  })

  test("switching the host's tabs keeps the live page and its input", async () => {
    await a("browser_focus", { target: one.target })
    // The title arrives from the page a moment after the tab does.
    await waitFor(
      () => ui("[...document.querySelectorAll('[role=tab]')].some(t=>t.textContent.includes('Tab A'))"),
      "Tab A is not titled"
    )
    await ui(
      "(()=>{const tab=[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.includes('Tab A'));if(!tab)throw Error('Missing A tab');tab.click();return true})()"
    )
    assert.equal(await draft(a, one.target), "AI A draft 中文")
  })

  test("acting in one tab leaves the other alone, and only one page shows", async () => {
    await a("browser_click", { target: one.target, selector: 'role=button[name="Save"]' })
    await a("browser_wait", { target: one.target, selector: '#result:text-is("Saved")' })
    assert.equal(
      (await b("browser_evaluate", { target: two.target, expression: "document.querySelector('#result').textContent" }))
        .result,
      ""
    )
    assert.equal(
      Number(await ui("[...document.querySelectorAll('embed')].filter(e=>e.getBoundingClientRect().width>0).length")),
      1
    )
  })

  test("the tab goes back, forward and reloads through its native history", async () => {
    await a("browser_navigate", { target: one.target, url: `${origin}/A-next` })
    await ipc("cef_guest_history", { label: one.target, action: "back" })
    await a("browser_wait", { target: one.target, selector: 'body[data-route="/A"]' })
    await ipc("cef_guest_history", { label: one.target, action: "forward" })
    await a("browser_wait", { target: one.target, selector: 'body[data-route="/A-next"]' })
    await ipc("cef_guest_history", { label: one.target, action: "reload" })
    await a("browser_wait", { target: one.target, selector: 'body[data-route="/A-next"]' })
  })

  test("closing one conversation's tab leaves the other's where it was", async () => {
    await b("browser_close", { target: two.target })
    assert.ok(!(await b("browser_list")).targets.some((target: any) => target.id === two.target))
    assert.equal(
      (await a("browser_evaluate", { target: one.target, expression: "location.pathname" })).result,
      "/A-next"
    )
  })
})
