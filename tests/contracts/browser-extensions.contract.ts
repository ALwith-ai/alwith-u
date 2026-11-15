/**
 * Extension isolation contract: an extension works on the websites in tabs and
 * never reaches the application's own interface. The test profile keeps the worker it first registered: after
 * changing the fixture's worker, remove `Default/Service Worker` from that profile. Launch the fixture with
 * ALWITH_U_CEF_TEST_EXTENSION pointing at tests/contracts/fixtures/browser-extension.
 */
import assert from "node:assert/strict"

import { afterAll, afterEach, beforeAll, describe, test } from "vitest"

import { type BrowserTools, conversations, ipc, reportFailure, requireBrowserFixture, ui } from "./lib/app"

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) =>
    new Response(`<title>Site</title><body data-route="${new URL(request.url).pathname}">`, {
      headers: { "Content-Type": "text/html" }
    })
})
const site = `http://127.0.0.1:${server.port}`
const talks = conversations("extension-contract")
const targets: string[] = []

describe("browser extensions", () => {
  const visible = "document.querySelector('[role=tabpanel]:not([hidden])')"
  const button = `${visible}.querySelector('button[aria-label="ALwith browser contract"]')`
  let a: BrowserTools
  let b: BrowserTools
  let one: any
  let calls = 0
  let window: any
  let count: number
  let created: any
  let behind: any
  let other: any
  let tab: number
  const page = async (expression: string) => (await a("browser_evaluate", { target: one.target, expression })).result
  const settled = async (read: () => Promise<unknown>, message: string) => {
    const deadline = Date.now() + 10000
    let last: unknown
    while (Date.now() < deadline) {
      last = await read()
      if (last) return String(last)
      await Bun.sleep(100)
    }
    throw new Error(`${message} (last: ${JSON.stringify(last)})`)
  }
  // The worker's blocking rule applies to the website's requests, and only to the ones it names.
  const request = (path: string) => `fetch(${JSON.stringify(path)}).then((r) => "reached " + r.status, () => "blocked")`
  const popup = () =>
    ui(
      `(() => { const surface = [...document.querySelectorAll('embed')].find((embed) => embed.title === 'ALwith browser contract 弹出页'); return surface ? Math.round(surface.getBoundingClientRect().width) + 'x' + Math.round(surface.getBoundingClientRect().height) : '' })()`
    )
  // A page the extension opens for itself arrives as a tab of the user's, not as a window of the browser's.
  const tabs = () => ui("JSON.stringify([...document.querySelectorAll('[role=tab]')].map((tab) => tab.textContent))")
  const extension = async (call: string, ...args: unknown[]) => {
    const id = ++calls
    await page(
      `dispatchEvent(new CustomEvent("contract-call", { detail: ${JSON.stringify({ id, call, args })} })), true`
    )
    const reply = JSON.parse(
      await settled(async () => {
        const reply = String(await page("document.documentElement.dataset.contractReply ?? ''"))
        return reply && JSON.parse(reply).id === id ? reply : ""
      }, `The extension did not answer ${call}`)
    )
    if (reply.error) throw new Error(`${call}: ${reply.error}`)
    return reply.value
  }
  // The tab is the one the extension was told of, in the window it knows, and its to address from then on.
  const selectedTab = () =>
    ui("[...document.querySelectorAll('[role=tab]')].findIndex((tab) => tab.getAttribute('aria-selected') === 'true')")
  const silenced = () => ui(`document.querySelectorAll('[role=tab] [aria-label="已静音"]').length`)
  const heard = async (name: string, tab: number) =>
    (await extension("events")).filter(
      ([event, first]: [string, { id?: number; tabId?: number } | number]) =>
        event === name && (typeof first === "number" ? first : (first.id ?? first.tabId)) === tab
    )
  // The strip's order and its pinned tabs are the extension's to read and to ask for; the strip decides.
  const place = async (id: number) => {
    const tab = await extension("tabs.get", id)
    return [tab.index, tab.pinned]
  }
  // The user takes the button out of the toolbar and puts it back, from the browser menu.
  const toggle = async () => {
    await ui(`${visible}.querySelector('button[aria-label="浏览器菜单"]').click(), true`)
    await settled(
      () =>
        ui(
          `[...document.querySelectorAll('[role=menuitemcheckbox]')].some((item) => item.textContent === 'ALwith browser contract')`
        ),
      "The extension is not listed in the browser menu"
    )
    await ui(
      `[...document.querySelectorAll('[role=menuitemcheckbox]')].find((item) => item.textContent === 'ALwith browser contract').click(), true`
    )
    await ui(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`)
  }

  beforeAll(async () => {
    await ipc("plugin:window|show", { label: "main" })
    await requireBrowserFixture()
    a = await talks.agent()
    one = await a("browser_open", { url: `${site}/site` })
    targets.push(one.target)
  })

  afterEach(reportFailure)

  afterAll(async () => {
    await talks.close()
    for (const label of targets) await ipc("cef_close_guest", { label }).catch(() => {})
    await server.stop(true)
  })

  test("on a website the content script runs and the worker scripts the tab", async () => {
    assert.match(
      await settled(() => page("document.documentElement.dataset.contractExtension"), "No content script in the tab"),
      /^[a-p]{32}$/
    )
    assert.equal(
      await settled(
        () => page("document.documentElement.dataset.contractWorker"),
        "The extension worker did not answer"
      ),
      "ready: Site"
    )
  })

  test("the worker's blocking rule stops the website's requests it names, and only those", async () => {
    assert.equal(await page(request("/blocked-by-extension")), "blocked")
    assert.equal(await page(request("/other")), "reached 200")
  })

  test("the application's own document is closed to the extension", async () => {
    assert.equal(await ui("document.documentElement.dataset.contractExtension ?? null"), null)
    assert.match(String(await ui(request("/blocked-by-extension"))), /^reached /)
  })

  test("the toolbar button shows the extension's popup, sized by its content, which closes itself", async () => {
    await settled(
      () => ui(`${visible}.querySelector('button[aria-label="ALwith browser contract"]') !== null`),
      "The extension has no button in the toolbar"
    )
    await ui(`${visible}.querySelector('button[aria-label="ALwith browser contract"]').click(), true`)
    await settled(async () => (await popup()) === "240x120", "The popup did not open at the size of its content")
    await page(`dispatchEvent(new CustomEvent("contract-close-popup")), true`)
    await settled(async () => (await popup()) === "", "The popup did not close itself")
  })

  test("the popup finds the tab it was opened over", async () => {
    await page(`dispatchEvent(new CustomEvent("contract-popup-tab")), true`)
    assert.equal(
      await settled(
        () => page("document.documentElement.dataset.contractPopupTab"),
        "The popup's tab was not reported"
      ),
      `${site}/site`
    )
  })

  test("a page the extension opens for itself arrives as a tab of the user's", async () => {
    const before = JSON.parse(String(await tabs())).length
    await page(
      `dispatchEvent(new CustomEvent("contract-open", { detail: "http://127.0.0.1:${server.port}/welcome" })), true`
    )
    await settled(() => page("document.documentElement.dataset.contractOpened"), "The extension could not open a page")
    await settled(
      async () => JSON.parse(String(await tabs())).length === before + 1,
      "The extension's page did not become a tab"
    )
    assert.equal(
      await settled(
        () => ui("document.querySelector('[role=tabpanel]:not([hidden]) input[aria-label=\"网页地址\"]')?.value"),
        "The new tab has no address"
      ),
      `${site}/welcome`
    )
  })

  test("the application's window and its tabs are what windows and tabs queries answer with", async () => {
    const address = `${site}/site`
    window = await extension("windows.getCurrent", { populate: true })
    assert.equal(window.type, "normal")
    assert.equal((await extension("windows.getLastFocused")).id, window.id)
    assert.deepEqual(
      (await extension("windows.getAll")).map((entry: { id: number }) => entry.id),
      [window.id]
    )
    const own = window.tabs.find((tab: { url: string }) => tab.url === address)
    assert.equal(own.windowId, window.id)
    assert.deepEqual(
      (await extension("tabs.query", { windowId: window.id, url: address })).map((tab: { id: number }) => tab.id),
      [own.id]
    )
    assert.equal((await extension("tabs.get", own.id)).windowId, window.id)
  })

  test("tabs.create opens a tab of the user's in front, known by the identity it answered with", async () => {
    count = JSON.parse(String(await tabs())).length
    created = await extension("tabs.create", { url: `${site}/created` })
    await settled(
      async () => JSON.parse(String(await tabs())).length === count + 1,
      "tabs.create did not open a tab of the user's"
    )
    assert.equal(created.windowId, window.id)
    assert.equal(created.active, true)
    await settled(async () => (await selectedTab()) === count, "A created tab did not come to the front")
    await settled(
      async () => (await extension("tabs.get", created.id)).url === `${site}/created`,
      "The tab tabs.create answered with is not the tab that opened"
    )
  })

  test("a tab asked for behind the others loads there", async () => {
    behind = await extension("tabs.create", {
      url: `${site}/behind`,
      active: false,
      windowId: window.id
    })
    assert.equal(behind.active, false)
    await settled(
      async () => (await extension("tabs.get", behind.id)).status === "complete",
      "A tab created behind the others did not load"
    )
    assert.equal(await selectedTab(), count, "A tab created behind the others took the front")
  })

  test("tabs.update brings a tab forward and mutes it", async () => {
    assert.equal((await extension("tabs.update", behind.id, { active: true })).active, true)
    await settled(async () => (await selectedTab()) === count + 1, "tabs.update did not bring a tab forward")
    await extension("tabs.update", behind.id, { muted: true })
    await settled(async () => (await silenced()) === 1, "A tab an extension muted does not say so")
  })

  test("a tab says where it is in the strip, and tabs.move moves it there", async () => {
    await settled(
      async () => JSON.stringify(await place(behind.id)) === JSON.stringify([count + 1, false]),
      "A tab does not say where it is in the strip"
    )
    assert.deepEqual(
      (await extension("tabs.query", { index: count + 1 })).map((tab: { id: number }) => tab.id),
      [behind.id]
    )
    assert.equal((await extension("tabs.move", behind.id, { index: count })).index, count)
    await settled(
      async () =>
        (await place(behind.id))[0] === count &&
        (await place(created.id))[0] === count + 1 &&
        (await selectedTab()) === count,
      "tabs.move did not move the tab in the strip"
    )
    await settled(
      async () =>
        (await heard("onMoved", behind.id)).some(
          ([, , moved]: [string, number, { fromIndex: number; toIndex: number }]) =>
            moved.fromIndex === count + 1 && moved.toIndex === count
        ),
      "No tabs.onMoved"
    )
    assert.equal((await heard("onMoved", created.id)).length, 0, "A tab that made room was said to have moved")
  })

  test("tabs.update pins a tab and lets it go", async () => {
    assert.equal((await extension("tabs.update", behind.id, { pinned: true })).pinned, true)
    await settled(
      async () =>
        (await place(behind.id))[1] === true &&
        (await ui(`document.querySelectorAll('[role=tab] .sr-only').length`)) >= 1,
      "tabs.update did not pin the tab in the strip"
    )
    assert.deepEqual(
      (await extension("tabs.query", { pinned: true })).map((tab: { id: number }) => tab.id),
      [behind.id]
    )
    await extension("tabs.update", behind.id, { pinned: false })
    await settled(async () => (await place(behind.id))[1] === false, "tabs.update did not let a pinned tab go")
  })

  test("tabs.duplicate opens the page again in a tab of its own", async () => {
    const copy = await extension("tabs.duplicate", created.id)
    await settled(
      async () => (await extension("tabs.get", copy.id)).url === `${site}/created`,
      "tabs.duplicate did not open the page again"
    )
    assert.notEqual(copy.id, created.id)
    await extension("tabs.remove", copy.id)
  })

  test("windows.update is answered with the application's window as it is", async () => {
    assert.equal((await extension("windows.update", window.id, { focused: true })).id, window.id)
  })

  test("of the tabs an extension highlights, the first comes forward", async () => {
    const front = (await extension("tabs.get", created.id)).index
    assert.equal((await extension("tabs.highlight", { tabs: [front, front + 1] })).id, window.id)
    await settled(async () => (await selectedTab()) === front, "tabs.highlight did not bring the tab forward")
  })

  test("tabs.remove closes the user's tabs", async () => {
    await extension("tabs.remove", [behind.id, created.id])
    await settled(
      async () => JSON.parse(String(await tabs())).length === count,
      "tabs.remove did not close the user's tabs"
    )
  })

  test("the options page opens as a tab", async () => {
    await extension("runtime.openOptionsPage")
    await settled(
      async () => JSON.parse(String(await tabs())).includes("Contract options"),
      "The options page did not open as a tab"
    )
  })

  test("the extension hears a tab open, finish loading and take a title", async () => {
    b = await talks.agent()
    other = await b("browser_open", { url: `${site}/other-tab` })
    targets.push(other.target)
    const opened = await settled(
      async () => (await extension("tabs.query", { url: `${site}/other-tab` }))[0]?.id,
      "The extension does not see the new tab"
    )
    tab = Number(opened)
    await settled(async () => (await heard("onCreated", tab)).length === 1, "No tabs.onCreated")
    await settled(
      async () =>
        (await heard("onUpdated", tab)).some(
          ([, , changed]: [string, number, { status?: string }]) => changed.status === "complete"
        ),
      "No tabs.onUpdated for the finished load"
    )
    await b("browser_evaluate", { target: other.target, expression: "document.title = 'Renamed'" })
    await settled(
      async () =>
        (await heard("onUpdated", tab)).some(
          ([, , changed]: [string, number, { title?: string }]) => changed.title === "Renamed"
        ),
      "No tabs.onUpdated for the new title"
    )
  })

  test("the extension hears a tab come to the front", async () => {
    await ipc("cef_guest_extension_activate", { label: other.target })
    await settled(async () => (await heard("onActivated", tab)).length === 1, "No tabs.onActivated")
    assert.deepEqual((await heard("onActivated", tab))[0][1], { tabId: tab, windowId: window.id })
  })

  test("the extension hears the window leave the front and come back", async () => {
    await ipc("cef_guest_window_focus", { label: other.target, focused: false })
    await settled(async () => (await heard("onFocusChanged", -1)).length > 0, "No windows.onFocusChanged for leaving")
    await ipc("cef_guest_window_focus", { label: other.target, focused: true })
    await settled(
      async () => (await heard("onFocusChanged", window.id)).length > 0,
      "No windows.onFocusChanged for coming back"
    )
  })

  test("the extension hears a tab close", async () => {
    await ipc("cef_close_guest", { label: other.target })
    await settled(async () => (await heard("onRemoved", tab)).length === 1, "No tabs.onRemoved")
  })

  test("an entry the extension adds is in the page's context menu and runs", async () => {
    await extension("contextMenus.removeAll")
    await extension("contextMenus.create", { id: "contract", title: "Contract entry", contexts: ["all"] })
    await ipc("cef_guest_extension_activate", { label: one.target })
    await ui(
      `[...document.querySelectorAll('[role=tab]')].find((tab) => tab.textContent.includes('· AI')).click(), true`
    )
    const entry = `[...document.querySelectorAll('[data-page-menu] [role^=menuitem]')].find((item) => item.textContent === 'Contract entry')`
    await settled(async () => {
      for (const type of ["mousePressed", "mouseReleased"])
        await a("browser_cdp", {
          target: one.target,
          method: "Input.dispatchMouseEvent",
          params: { type, x: 40, y: 40, button: "right", clickCount: 1 }
        })
      await Bun.sleep(300)
      return ui(`${entry} !== undefined`)
    }, "The extension's entry is not in the page's context menu")
    await ui(`${entry}.click(), true`)
    await settled(
      async () =>
        (await extension("events")).some(
          ([event, info]: [string, { menuItemId?: string }]) => event === "onClicked" && info.menuItemId === "contract"
        ),
      "The extension did not hear its context-menu entry chosen"
    )
  })

  test("a badge the extension sets shows at once", async () => {
    await extension("action.setBadgeText", { text: "7" })
    const badgeDeadline = Date.now() + 2500
    while (!String(await ui(`${button}?.textContent ?? ''`)).includes("7")) {
      assert.ok(Date.now() < badgeDeadline, "The badge did not follow the extension within the time of one poll")
      await Bun.sleep(100)
    }
    await extension("action.setBadgeText", { text: "" })
  })

  test("the user takes the button out of the toolbar", async () => {
    await toggle()
    await settled(async () => (await ui(`${button} === null`)) === true, "The hidden button stayed in the toolbar")
  })

  test("out of the toolbar the extension is pressed from the menu, and the button comes back when asked", async () => {
    await ui(`${visible}.querySelector('button[aria-label="浏览器菜单"]').click(), true`)
    await settled(
      () => ui(`document.querySelector('[data-extension]') !== null`),
      "The hidden extension is not offered"
    )
    await ui(`document.querySelector('[data-extension]').click(), true`)
    await settled(async () => (await popup()) === "240x120", "The hidden extension's popup did not open")
    await page(`dispatchEvent(new CustomEvent("contract-close-popup")), true`)
    await settled(async () => (await popup()) === "", "The hidden extension's popup did not close")
    await settled(async () => (await ui(`${button} === null`)) === true, "The button stayed after its popup closed")
    await toggle()
    await settled(async () => (await ui(`${button} !== null`)) === true, "The button did not come back to the toolbar")
  })

  test("the page that manages extensions is never a conversation's to visit", async () => {
    await assert.rejects(ipc("cef_navigate_guest", { label: one.target, url: "chrome://extensions/" }), /HTTP\(S\)/)
    assert.equal(await page("location.pathname"), "/site")
  })
})
