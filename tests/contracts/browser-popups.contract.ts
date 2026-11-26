/** Popup contract: windows a page opens become tabs that keep the page's own relationships. */
import assert from "node:assert/strict"

import { afterAll, afterEach, beforeAll, describe, test } from "vitest"

import { type BrowserTools, conversations, ipc, reportFailure, requireBrowserFixture, ui, waitFor } from "./lib/app"

describe("browser popups", () => {
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
  const talks = conversations("popup-contract")
  const targets: string[] = []
  let a: BrowserTools
  let b: BrowserTools
  let one: any
  let baseline: number
  let popup: any
  let blank: any
  let nested: any
  let kept: any
  let late: string
  async function evaluate(target: string, expression: string) {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return (
        await Promise.race([
          a("browser_evaluate", { target, expression }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error(`Evaluation timed out: ${expression}`)), 15000)
          })
        ])
      ).result
    } finally {
      clearTimeout(timeout)
    }
  }
  const count = async () => (await a("browser_list")).targets.length
  const route = (target: string, path: string) => a("browser_wait", { target, selector: `body[data-route="${path}"]` })
  const strip = async () =>
    String(await ui("[...document.querySelectorAll('[role=tab]')].map(t=>t.textContent).join('|')"))
  const survivors = (): Promise<string[]> =>
    a("browser_list").then((list: any) =>
      list.targets.map((value: any) => value.id).filter((id: string) => id.startsWith("browser-popup-"))
    )

  beforeAll(async () => {
    await ipc("show_main_window")
    await requireBrowserFixture()
    ;[a, b] = await Promise.all([talks.agent(), talks.agent()])
    one = await a("browser_open", { url: `${origin}/opener` })
    targets.push(one.target)
    baseline = await count()
  })

  afterEach(reportFailure)

  afterAll(async () => {
    await talks.close()
    for (const label of targets) await ipc("cef_close_guest", { label }).catch(() => {})
    await server.stop(true)
  })

  test("a website's page does not see the application's own interfaces", async () => {
    assert.equal(await evaluate(one.target, "typeof window.__TAURI_INTERNALS__"), "undefined")
  })

  test("window.open gives the page its window and the user a tab", async () => {
    assert.equal(await evaluate(one.target, `!!(window.child = window.open('${origin}/child','login'))`), true)
    await waitFor(async () => (await count()) === baseline + 1, "Popup was not registered")
    popup = (await a("browser_list")).targets.find((value: any) => value.id.startsWith("browser-popup-"))
    assert.ok(popup)
    targets.push(popup.id)
    await route(popup.id, "/child")
    await waitFor(async () => (await strip()).includes("Tab child"), "Popup title missing from tabs")
  })

  test("opener and popup reach each other's documents on the same origin", async () => {
    assert.equal(await evaluate(popup.id, "window.opener !== null"), true)
    assert.equal(await evaluate(one.target, "window.child.document.body.dataset.route"), "/child")
    assert.equal(await evaluate(popup.id, "window.opener.document.body.dataset.route"), "/opener")
  })

  test("the popup belongs to the conversation that opened it", async () => {
    // Another conversation sees whose the popup is, and that it is not for it to use.
    const listed = (await b("browser_list")).targets.find((value: any) => value.id === popup.id)
    assert.equal(listed?.available, false, JSON.stringify(listed))
    assert.ok(listed.ownerSessionId)
    await assert.rejects(b("browser_read_page", { target: popup.id }), /403/)
  })

  test("opening the same window name again reuses the popup", async () => {
    assert.equal(
      await evaluate(one.target, "window.same = window.open('/reused','login'); window.same === window.child"),
      true
    )
    await route(popup.id, "/reused")
    assert.equal(await count(), baseline + 1)
  })

  test("a popup on another origin still posts its message to the opener", async () => {
    await evaluate(one.target, "window.addEventListener('message', event => window.received = event.data)")
    await evaluate(popup.id, `location.href = "http://localhost:${server.port}/cross-origin"; true`)
    await route(popup.id, "/cross-origin")
    await evaluate(popup.id, `window.opener.postMessage('oauth-complete','${origin}')`)
    await waitFor(
      async () => (await evaluate(one.target, "window.received")) === "oauth-complete",
      "Cross-origin callback lost"
    )
  })

  test("window.close closes the tab and the opener sees it closed", async () => {
    await evaluate(popup.id, "setTimeout(() => window.close(), 100); true")
    await waitFor(
      async () => !(await a("browser_list")).targets.some((value: any) => value.id === popup.id),
      "window.close did not remove tab"
    )
    assert.equal(await evaluate(one.target, "window.child.closed"), true)
  })

  test("a target=_blank link opens a tab without an opener", async () => {
    await evaluate(
      one.target,
      `document.body.insertAdjacentHTML('beforeend','<a id="blank" target="_blank" href="/blank">Open</a>')`
    )
    await a("browser_focus", { target: one.target })
    await a("browser_click", { target: one.target, selector: "#blank" })
    await waitFor(async () => (await count()) === baseline + 1, "target=_blank missing")
    blank = (await a("browser_list")).targets.find((value: any) => value.id.startsWith("browser-popup-"))
    targets.push(blank.id)
    await route(blank.id, "/blank")
    assert.equal(await evaluate(blank.id, "window.opener === null"), true)
  })

  test("a popup opens a popup of its own", async () => {
    await evaluate(blank.id, "window.open('/nested','nested') !== null")
    await waitFor(async () => (await count()) === baseline + 2, "Nested popup missing")
    nested = (await a("browser_list")).targets.find(
      (value: any) => value.id.startsWith("browser-popup-") && value.id !== blank.id
    )
    targets.push(nested.id)
    await route(nested.id, "/nested")
    await evaluate(nested.id, "window.savedOpener = window.opener; true")
  })

  test("a tab keeps its opener, to observe the opener's closure from the page", async () => {
    await evaluate(one.target, "window.kept = window.open('/kept','kept'); true")
    await waitFor(async () => (await count()) === baseline + 3, "Kept popup missing")
    kept = (await a("browser_list")).targets.find(
      (value: any) => value.id.startsWith("browser-popup-") && ![blank.id, nested.id].includes(value.id)
    )
    targets.push(kept.id)
    await route(kept.id, "/kept")
    await evaluate(kept.id, "window.savedOpener = window.opener; true")
  })

  test("closing the opener leaves every tab it opened", async () => {
    await a("browser_close", { target: one.target })
    await waitFor(
      async () => !(await a("browser_list")).targets.some((value: any) => value.id === one.target),
      "Opener did not close"
    )
    await waitFor(async () => (await evaluate(kept.id, "window.savedOpener.closed")) === true, "Opener still open")
    assert.equal(await evaluate(kept.id, "window.opener === null || window.opener.closed"), true)
    assert.deepEqual((await survivors()).toSorted(), [blank.id, nested.id, kept.id].toSorted())
    await waitFor(async () => (await strip()).includes("Tab kept"), "Surviving tab left the tab strip")
  })

  test("the orphaned tab still types, clicks, navigates and stays its conversation's", async () => {
    await a("browser_type", {
      target: kept.id,
      selector: "#draft",
      text: "still here"
    })
    assert.equal(await evaluate(kept.id, "document.querySelector('#draft').value"), "still here")
    await a("browser_click", { target: kept.id, selector: "button" })
    assert.equal(await evaluate(kept.id, "document.querySelector('#result').textContent"), "Saved")
    await a("browser_navigate", { target: kept.id, url: `${origin}/moved` })
    await route(kept.id, "/moved")
    assert.equal((await b("browser_list")).targets.find((value: any) => value.id === kept.id)?.available, false)
    await assert.rejects(b("browser_read_page", { target: kept.id }), /403/)
  })

  test("the orphaned tab still opens tabs of its own, owned by the same conversation", async () => {
    await evaluate(kept.id, "window.late = window.open('/late','late'); true")
    await waitFor(async () => (await survivors()).length === 4, "Popup after opener closure missing")
    late = (await survivors()).find((id) => ![blank.id, nested.id, kept.id].includes(id))!
    targets.push(late)
    await route(late, "/late")
    assert.equal(await evaluate(late, "window.opener.document.body.dataset.route"), "/moved")
    await assert.rejects(b("browser_read_page", { target: late }), /403/)
  })

  test("closing an intermediate tab leaves the tab it opened", async () => {
    await a("browser_close", { target: blank.id })
    await waitFor(async () => !(await survivors()).includes(blank.id), "Intermediate tab did not close")
    await waitFor(
      async () => (await evaluate(nested.id, "window.savedOpener.closed")) === true,
      "Intermediate still open"
    )
    await a("browser_type", {
      target: nested.id,
      selector: "#draft",
      text: "nested"
    })
    assert.equal(await evaluate(nested.id, "document.querySelector('#draft').value"), "nested")
    assert.deepEqual((await survivors()).toSorted(), [nested.id, kept.id, late].toSorted())
  })

  test("each survivor closes on its own, without its opener", async () => {
    for (const id of [late, kept.id, nested.id]) {
      await a("browser_close", { target: id })
      await waitFor(async () => !(await survivors()).includes(id), `Survivor did not close: ${id}`)
    }
    assert.equal(await count(), baseline - 1)
  })
})
