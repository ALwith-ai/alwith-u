/** Standard browser chrome contract: native loading, history, failure, icons and in-page shortcuts. */
import assert from "node:assert/strict"

import { afterAll, afterEach, beforeAll, describe, test } from "vitest"

import { type BrowserTools, conversations, ipc, reportFailure, requireBrowserFixture, ui, waitFor } from "./lib/app"

// 1x1 red PNG.
const icon = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64"
)
let releaseSlow: (() => void) | undefined
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 60,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/icon.png") return new Response(icon, { headers: { "Content-Type": "image/png" } })
    if (path === "/favicon.ico") return new Response(null, { status: 404 })
    if (path === "/private")
      return request.headers.get("authorization") === `Basic ${btoa("ada:s3cret")}`
        ? new Response(`<title>Page private</title><body data-route="/private">`, {
            headers: { "Content-Type": "text/html" }
          })
        : new Response("unauthorized", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Staff"' } })
    if (path.startsWith("/stalled/"))
      // A download that never completes on its own.
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(65536))
          }
        }),
        {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": "10485760",
            "Content-Disposition": `attachment; filename="${path.slice(9)}"`
          }
        }
      )
    if (path.startsWith("/download/"))
      return new Response("downloaded by the browser contract", {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${path.slice(10)}"`
        }
      })
    if (path === "/slow")
      // The document never completes until released: a real in-flight load.
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("<title>Slow</title><body data-route='/slow'>partial"))
            releaseSlow = () => {
              // Stopping the load already aborted this response.
              try {
                controller.close()
              } catch {}
            }
          }
        }),
        { headers: { "Content-Type": "text/html" } }
      )
    return new Response(
      `<title>Page ${path.slice(1)}</title><link rel="icon" href="/icon.png"><body data-route="${path}"><input id="draft"><a id="next" href="/b">next</a><p>needle in a haystack, and another needle</p>`,
      { headers: { "Content-Type": "text/html" } }
    )
  }
})
const origin = `http://127.0.0.1:${server.port}`
const talks = conversations("chrome-contract")
const toolbar = (name: string) =>
  ui(
    `(() => { const panel = document.querySelector('[role=tabpanel]:not([inert])'); const button = [...panel.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(name)}); return button ? (button.disabled ? 'disabled' : 'enabled') : 'absent' })()`
  )
const progress = () =>
  ui(`document.querySelector('[role=tabpanel]:not([inert]) [role=progressbar]')?.getAttribute('aria-valuenow') ?? null`)
const tabCount = async () => Number(await ui(`document.querySelectorAll('[role=tab]').length`))
describe("browser chrome", () => {
  let a: BrowserTools
  let baseTabs: number
  let one: any
  let tabsBeforeStart: number
  let addressBeforeMenu: any
  let tabsBeforeMenu: number
  // Visits are remembered with their titles and answer what is typed in the address bar.
  const saved = async () =>
    JSON.parse(String((await ui(`localStorage.getItem('alwith.browser.library.v1')`)) ?? "null"))
  const typeAddress = (text: string) =>
    ui(
      `(() => { const panel = document.querySelector('[role=tabpanel]:not([inert])'); const input = panel.querySelector('input[aria-label="网页地址"]'); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`
    )
  // A raw key-down carrying its macOS key code is what a physical key press delivers.
  const chord = (windowsVirtualKeyCode: number, code: string, nativeVirtualKeyCode: number) =>
    a("browser_cdp", {
      target: one.target,
      method: "Input.dispatchKeyEvent",
      params: {
        type: "rawKeyDown",
        modifiers: 4,
        windowsVirtualKeyCode,
        nativeVirtualKeyCode,
        code,
        key: code.slice(3).toLowerCase()
      }
    })
  const evaluate = async (expression: string) =>
    (await a("browser_evaluate", { target: one.target, expression })).result
  const panel = (script: string) =>
    ui(`(() => { const panel = document.querySelector('[role=tabpanel]:not([inert])'); ${script} })()`)
  const press = (name: string) =>
    panel(
      `[...panel.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(name)} || b.textContent.trim() === ${JSON.stringify(name)}).click(); return true`
    )
  const matches = () => panel(`return panel.querySelector('[role=search] [aria-live]')?.textContent ?? ''`)
  // The page's context menu is the application's: drawn where the user pointed, with what a browser offers there.
  const rightClick = async (selector: string) => {
    const [x, y] = await evaluate(
      `(() => { const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)] })()`
    )
    for (const type of ["mousePressed", "mouseReleased"])
      await a("browser_cdp", {
        target: one.target,
        method: "Input.dispatchMouseEvent",
        params: { type, x, y, button: "right", clickCount: 1 }
      })
    return [x, y] as [number, number]
  }
  // Entries are asked for by what they do, which no language changes.
  const menuItems = () =>
    ui(
      `JSON.stringify([...document.querySelectorAll('[data-page-menu] [data-entry]')].map((item) => item.dataset.entry))`
    )
  const choose = (entry: string) =>
    ui(
      `[...document.querySelectorAll('[data-page-menu] [data-entry]')].find((item) => item.dataset.entry === ${JSON.stringify(entry)}).click(), true`
    )
  const shownAddress = () =>
    ui("document.querySelector('[role=tabpanel]:not([inert]) input[aria-label=\"网页地址\"]')?.value ?? ''")
  // A website asks the user; nothing is granted until they answer.
  const request = () =>
    evaluate(
      "window.answer = 'pending'; Notification.requestPermission().then((value) => (window.answer = value)); true"
    )
  const prompt = () => panel(`return panel.querySelector('[role=group][aria-label="网站权限请求"]')?.textContent ?? ''`)
  // The answer is kept, shown where the user looks at the site, and theirs to take back: the site asks again.
  const anywhere = (name: string) =>
    ui(
      `[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(name)} || b.textContent.trim() === ${JSON.stringify(name)}).click(), true`
    )
  const sitePermissions = () => ui(`document.querySelector('ul[aria-label="此网站的权限"]')?.textContent ?? ''`)
  // A server's login challenge is asked in the tab; a wrong password is asked again, a right one gets in.
  const login = (script: string) =>
    panel(`const form = panel.querySelector('form[aria-label="网站登录"]'); if (!form) return ''; ${script}`)
  const fill = (username: string, password: string) =>
    login(
      `const set = (label, value) => { const input = form.querySelector('input[aria-label="' + label + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }; set('用户名', ${JSON.stringify(username)}); set('密码', ${JSON.stringify(password)}); return true`
    )
  // Pages follow the application's one interface zoom, including on a site visited for the first time.
  const viewport = async () =>
    (
      await a("browser_evaluate", {
        target: one.target,
        expression: "({ width: innerWidth, ratio: devicePixelRatio })"
      })
    ).result

  beforeAll(async () => {
    await ipc("show_main_window")
    await requireBrowserFixture()
    a = await talks.agent()
    baseTabs = await tabCount()
  })

  afterEach(reportFailure)

  afterAll(async () => {
    await talks.close()
    // Leave no saved session behind for the next run.
    await ui(
      `(() => { for (const button of [...document.querySelectorAll('button[aria-label^="关闭标签"]')]) button.click(); return true })()`
    ).catch(() => {})
    await server.stop(true)
  })

  test("back and forward are offered as the native history allows", async () => {
    one = await a("browser_open", { url: `${origin}/a` })
    await a("browser_wait", { target: one.target, selector: 'body[data-route="/a"]' })
    await waitFor(async () => (await toolbar("刷新")) === "enabled", "Reload not offered after load")
    assert.equal(await toolbar("后退"), "disabled")
    assert.equal(await toolbar("前进"), "disabled")
    await a("browser_click", { target: one.target, selector: "#next" })
    await a("browser_wait", { target: one.target, selector: 'body[data-route="/b"]' })
    await waitFor(async () => (await toolbar("后退")) === "enabled", "Back unavailable after a navigation")
    assert.equal(await toolbar("前进"), "disabled")
    await ipc("cef_guest_history", { label: one.target, action: "back" })
    await a("browser_wait", { target: one.target, selector: 'body[data-route="/a"]' })
    await waitFor(async () => (await toolbar("前进")) === "enabled", "Forward unavailable after going back")
    assert.equal(await toolbar("后退"), "disabled")
  })

  test("visits are remembered with their titles and suggested in the address bar", async () => {
    await waitFor(
      async () =>
        (await saved())?.history.filter((visit: any) => visit.url.startsWith(origin) && /^Page [ab]$/.test(visit.title))
          .length === 2,
      "Visits were not recorded with their titles"
    )
    const visitsToA = (await saved()).history.find((visit: any) => visit.url === `${origin}/a`).visits
    assert.ok(visitsToA >= 2, "Going back to a page is a visit to it")
    await typeAddress(`127.0.0.1:${server.port}/b`)
    const offered = String(
      await waitFor(
        () => ui(`document.querySelector('[role=tabpanel]:not([inert]) [role=listbox]')?.textContent ?? ''`),
        "No address suggestions"
      )
    )
    assert.ok(offered.includes("Page b"), `Suggestions did not offer the visited page: ${offered}`)
    await ui(`document.querySelector('[role=tabpanel]:not([inert]) input[aria-label="网页地址"]').blur(); true`)
  })

  test("a bookmark is kept and offered on a blank tab's start page", async () => {
    await ui(
      `[...document.querySelector('[role=tabpanel]:not([inert])').querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '添加书签').click(); true`
    )
    await waitFor(
      async () => (await saved()).bookmarks.some((bookmark: any) => bookmark.url === `${origin}/a`),
      "Bookmark not saved"
    )
    tabsBeforeStart = Number(await ui(`document.querySelectorAll('[role=tab]').length`))
    await ui(`document.querySelector('button[aria-label="新建网页标签"]').click(); true`)
    const start = String(
      await waitFor(
        () => ui(`document.querySelector('[role=tabpanel]:not([inert]) nav[aria-label="起始页"]')?.textContent ?? ''`),
        "A blank tab did not show the start page"
      )
    )
    assert.ok(start.includes("书签") && start.includes("Page a"), `Start page did not offer the bookmark: ${start}`)
    await ui(
      `[...document.querySelectorAll('[role=tabpanel]:not([inert]) nav button')].find((b) => b.textContent.includes('Page a')).click(); true`
    )
    await waitFor(
      async () =>
        (await ui(
          `document.querySelector('[role=tabpanel]:not([inert]) nav[aria-label="起始页"]') === null && document.querySelector('[role=tab][aria-selected=true]').textContent.includes('Page a')`
        )) === true,
      "The start page did not open the bookmark in its tab"
    )
    await ui(`document.querySelector('[role=tab][aria-selected=true] button[aria-label^="关闭标签"]').click(); true`)
    await waitFor(
      async () => Number(await ui(`document.querySelectorAll('[role=tab]').length`)) === tabsBeforeStart,
      "Extra tab not closed"
    )
    await a("browser_focus", { target: one.target })
    await waitFor(async () => (await toolbar("移除书签")) === "enabled", "Bookmark state not shown")
    await ui(
      `[...document.querySelector('[role=tabpanel]:not([inert])').querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '移除书签').click(); true`
    )
  })

  test("the page's own icon shows in its tab", async () => {
    await waitFor(
      async () =>
        String(await ui(`document.querySelector('[role=tab][aria-selected=true] img')?.src ?? ''`)).startsWith(
          "data:image/png;base64,"
        ),
      "Tab icon missing"
    )
  })

  test("find in page counts matches natively", async () => {
    await ui(
      `document.querySelector('section[aria-label="网页工作区"]').dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', metaKey: true, bubbles: true })); true`
    )
    await waitFor(
      async () => (await ui(`document.activeElement?.getAttribute('aria-label')`)) === "查找内容",
      "Cmd+F did not open find"
    )
    await panel(
      `const input = panel.querySelector('[role=search] input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'needle'); input.dispatchEvent(new Event('input', { bubbles: true })); return true`
    )
    await waitFor(async () => (await matches()) === "1/2", "Find did not report native match counts")
    await press("下一个匹配项")
    await waitFor(async () => (await matches()) === "2/2", "Find did not step to the next match")
    await press("关闭查找")
    await waitFor(
      async () => (await panel(`return panel.querySelector('[role=search]') === null`)) === true,
      "Find stayed open"
    )
  })

  test("a page that handles the find chord itself keeps it", async () => {
    await evaluate(
      "addEventListener('keydown', (event) => { if (event.code === 'KeyF' && event.metaKey) { event.preventDefault(); window.ownFind = true } }); true"
    )
    await chord(70, "KeyF", 3)
    await waitFor(
      async () => (await evaluate("window.ownFind === true")) === true,
      "The page did not receive its own find chord"
    )
    await Bun.sleep(300)
    assert.equal(await panel(`return panel.querySelector('[role=search]') === null`), true)
  })

  test("a link's context menu is drawn where the user pointed and opens the link in a new tab", async () => {
    addressBeforeMenu = await shownAddress()
    const [linkX, linkY] = await rightClick("#next")
    await waitFor(async () => String(await menuItems()).includes("copy:"), "No context menu for a link")
    // A page that can be pointed at offers that first, then what belongs to the link.
    assert.deepEqual(JSON.parse(String(await menuItems())).slice(0, 3), ["say", `open:${origin}/b`, `copy:${origin}/b`])
    const placed = JSON.parse(
      String(
        await panel(
          `const surface = panel.querySelector('embed').getBoundingClientRect(); const menu = document.querySelector('span[data-slot=dropdown-menu-trigger]').getBoundingClientRect(); return JSON.stringify([menu.left - surface.left, menu.top - surface.top])`
        )
      )
    )
    assert.ok(
      Math.abs(placed[0] - linkX) <= 1 && Math.abs(placed[1] - linkY) <= 1,
      `The menu is not where the user pointed: ${String(placed)} for ${linkX},${linkY}`
    )
    tabsBeforeMenu = await tabCount()
    await choose(`open:${origin}/b`)
    await waitFor(async () => (await tabCount()) === tabsBeforeMenu + 1, "The link did not open in a new tab")
    assert.equal(await menuItems(), "[]")
    assert.equal(
      await ui("document.querySelector('[role=tabpanel]:not([inert]) input[aria-label=\"网页地址\"]')?.value"),
      `${origin}/b`
    )
    await ui(`document.querySelector('[role=tab][aria-selected=true] button[aria-label^="关闭标签"]').click(); true`)
    await waitFor(async () => (await tabCount()) === tabsBeforeMenu, "The tab the link opened did not close")
    await waitFor(
      async () => (await shownAddress()) === addressBeforeMenu,
      "The first tab did not come back to the front"
    )
  })

  test("a text field gets an editing menu, and a menu left alone goes away", async () => {
    await evaluate(
      "document.querySelector('#draft').value = 'draft text'; document.querySelector('#draft').select(); true"
    )
    await rightClick("#draft")
    await waitFor(async () => String(await menuItems()).includes("command:114"), "No editing menu in a text field")
    await choose("command:112")
    await waitFor(
      async () => (await evaluate("document.querySelector('#draft').value")) === "",
      "Cut did not reach the page"
    )
    await rightClick("#next")
    await waitFor(async () => String(await menuItems()).includes("copy:"), "No second context menu")
    await ui(
      `document.querySelector('.fixed.inset-0.z-40').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true`
    )
    await waitFor(async () => (await menuItems()) === "[]", "A dismissed menu stayed open")
  })

  test("the page's source opens in a tab of the user's and keeps saying it shows the source", async () => {
    await evaluate("getSelection().removeAllRanges(); document.activeElement.blur(); true")
    const [blankX, blankY] = [600, 500]
    for (const type of ["mousePressed", "mouseReleased"])
      await a("browser_cdp", {
        target: one.target,
        method: "Input.dispatchMouseEvent",
        params: { type, x: blankX, y: blankY, button: "right", clickCount: 1 }
      })
    await waitFor(async () => String(await menuItems()).includes('"source"'), "No page menu on the page itself")
    await choose("source")
    await waitFor(async () => (await tabCount()) === tabsBeforeMenu + 1, "The source did not open in a new tab")
    await waitFor(
      async () => String(await shownAddress()).startsWith(`view-source:${origin}`),
      "The source tab does not show the page's address"
    )
    await Bun.sleep(1500)
    assert.ok(String(await shownAddress()).startsWith(`view-source:${origin}`))
    await ui(`document.querySelector('[role=tab][aria-selected=true] button[aria-label^="关闭标签"]').click(); true`)
    await waitFor(async () => (await shownAddress()) === addressBeforeMenu, "The page did not come back to the front")
  })

  test("a permission is asked of the user and a refusal reaches the page", async () => {
    await request()
    assert.match(String(await waitFor(prompt, "No permission prompt was shown")), /127\.0\.0\.1.*想要使用：通知/)
    assert.equal(await evaluate("window.answer"), "pending")
    assert.equal(await evaluate("Notification.permission"), "default")
    await press("拒绝")
    await waitFor(async () => (await evaluate("window.answer")) === "denied", "A refusal did not reach the page")
    assert.equal(await prompt(), "")
  })

  test("another site is asked separately, an abandoned request closes and a grant reaches the page", async () => {
    await a("browser_navigate", { target: one.target, url: `http://localhost:${server.port}/a` })
    await request()
    await waitFor(prompt, "No permission prompt for the second site")
    await a("browser_navigate", { target: one.target, url: `http://localhost:${server.port}/b` })
    await waitFor(async () => (await prompt()) === "", "The prompt outlived its page")
    assert.equal(await evaluate("Notification.permission"), "default")
    await request()
    await waitFor(prompt, "No permission prompt after navigation")
    await press("允许")
    await waitFor(async () => (await evaluate("window.answer")) === "granted", "A grant did not reach the page")
  })

  test("a screen share is asked about and can be refused", async () => {
    await a("browser_cdp", {
      target: one.target,
      method: "Runtime.evaluate",
      params: {
        userGesture: true,
        expression:
          "window.shared = 'pending'; navigator.mediaDevices.getDisplayMedia({ video: true }).then((stream) => { window.shared = stream.getVideoTracks().length; for (const track of stream.getTracks()) track.stop() }, (error) => (window.shared = error.name)); true"
      }
    })
    assert.match(
      String(await waitFor(prompt, "No prompt for a screen share")),
      /想要使用：屏幕共享.*共享窗口.*共享屏幕/
    )
    assert.equal(await evaluate("window.shared"), "pending")
    await press("拒绝")
    await waitFor(async () => (await evaluate("window.shared")) === "NotAllowedError", "A refused screen share went on")
  })

  test("a granted permission is listed for the site and can be taken back", async () => {
    await press("网页信息")
    assert.match(String(await waitFor(sitePermissions, "The granted permission is not listed")), /通知.*已允许/)
    await anywhere("重置权限")
    await waitFor(
      async () => (await evaluate("Notification.permission")) === "default",
      "The permission was not taken back"
    )
    await waitFor(async () => (await sitePermissions()) === "", "A reset permission is still listed")
  })

  test("clearing a site's data empties its storage and loads the page afresh", async () => {
    await evaluate("localStorage.setItem('kept', 'yes'); document.cookie = 'kept=yes'; window.beforeClear = true; true")
    await anywhere("清除此网站的数据")
    await waitFor(
      async () =>
        (await a("browser_evaluate", {
          target: one.target,
          expression: "window.beforeClear !== true && document.readyState === 'complete'"
        })
          .then((reply: { result: unknown }) => reply.result)
          .catch(() => false)) === true,
      "The page was not loaded afresh"
    )
    assert.deepEqual(await evaluate("[localStorage.getItem('kept'), document.cookie]"), [null, ""])
    await ui(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`)
    await a("browser_navigate", { target: one.target, url: `${origin}/a` })
  })

  describe("downloads", () => {
    const file = `alwith-browser-contract-${crypto.randomUUID()}.txt`
    const downloads = `${process.env.HOME}/Downloads`
    const copies = [`${downloads}/${file}`, `${downloads}/${file.replace(".txt", " (1).txt")}`]
    const stalled = `alwith-browser-contract-${crypto.randomUUID()}.bin`
    const linked = `alwith-browser-contract-${crypto.randomUUID()}.txt`
    const landed = async (copy: string) => {
      await waitFor(async () => await Bun.file(copy).exists(), `Download missing: ${copy}`)
      await waitFor(
        async () => (await Bun.file(copy).text()) === "downloaded by the browser contract",
        "Download incomplete"
      )
    }
    const downloadsButton = () =>
      ui(
        `[...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')).find((label) => label?.startsWith('下载（')) ?? ''`
      )
    const inProgress = async () => Number(/（(\d+) 个进行中/.exec(String(await downloadsButton()))?.[1] ?? 0)
    const row = (script: string) =>
      ui(
        `(() => { const row = [...document.querySelectorAll('ul[aria-label="下载"] li')].find((item) => item.textContent.includes(${JSON.stringify(stalled)})); if (!row) return ''; ${script} })()`
      )

    afterAll(async () => {
      for (const copy of [
        ...copies,
        `${downloads}/${stalled}`,
        `${downloads}/${stalled}.crdownload`,
        `${downloads}/${linked}`
      ])
        await Bun.file(copy)
          .delete()
          .catch(() => {})
    })

    test("a download lands in the Downloads folder under the file's own name", async () => {
      await evaluate(`location.href = '/download/${file}'; true`)
      await landed(copies[0]!)
    })

    test("a repeated automatic download is asked about, and never lands over an existing file", async () => {
      // A second download the user did not start is the site's to ask for.
      await evaluate(`location.href = '/download/${file}'; true`)
      assert.match(
        String(await waitFor(prompt, "A repeated automatic download was not asked about")),
        /自动下载多个文件/
      )
      assert.equal(await Bun.file(copies[1]!).exists(), false)
      await press("允许")
      await landed(copies[1]!)
    })

    test("a download in progress is listed with its progress, and cancelling leaves nothing behind", async () => {
      const already = await inProgress()
      await evaluate(`location.href = '/stalled/${stalled}'; true`)
      // Yet another automatic download may be asked about first.
      await waitFor(async () => {
        if (await prompt()) await press("允许")
        return (await inProgress()) === already + 1
      }, "Download in progress not listed")
      // The popover opens on a pointer press, not a synthetic click.
      await ui(
        `(() => { const button = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.startsWith('下载（')); for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) button.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 })); return true })()`
      )
      // Received bytes are native; a percentage appears only when the server announced a size.
      await waitFor(
        async () =>
          /已下载 \d|%/.test(
            String(await row(`return row.textContent + (row.querySelector('[role=progressbar]') ? ' %' : '')`))
          ),
        "No download progress shown"
      )
      await row(`[...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消').click(); return true`)
      await waitFor(async () => (await inProgress()) === already, "Cancel did not end the download")
      assert.ok(String(await row(`return row.textContent`)).includes("已取消"))
      await waitFor(
        async () => !(await Bun.file(`${downloads}/${stalled}`).exists()),
        "A cancelled download left its file"
      )
      // The list is put away as a user would: left open it lies over the page for the steps that follow.
      await ui(
        `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`
      )
      await waitFor(
        async () => (await ui(`document.querySelector('ul[aria-label="下载"]') === null`)) === true,
        "The downloads list stayed open"
      )
    })

    test("a link's target is saved from the page's context menu without leaving the page", async () => {
      await evaluate(
        `document.body.insertAdjacentHTML('afterbegin', '<a id="linked" href="/download/${linked}" style="display:block;padding:20px">file</a>'); true`
      )
      await rightClick("#linked")
      await waitFor(async () => String(await menuItems()).includes("save:"), "The link is not offered for saving")
      await choose(`save:${origin}/download/${linked}`)
      await landed(`${downloads}/${linked}`)
      assert.equal(await evaluate("location.pathname"), "/a")
    })
  })

  test("a page's own dialogs never hold the application, and automation still gets their answers", async () => {
    // A dialog raised under a conversation's action is the conversation's to answer; the reader is shown it too.
    const asked = await a("browser_evaluate", {
      target: one.target,
      expression: "new Promise((resolve) => setTimeout(() => resolve(confirm('continue?')), 0))"
    })
    assert.equal(asked.pending, true, JSON.stringify(asked))
    assert.equal(asked.dialog.message, "continue?")
    // The application answers while the page waits: it is the page that is held, not the application.
    await waitFor(
      async () => (await panel(`return panel.querySelector('[role=alertdialog]') !== null`)) === true,
      "The reader is not shown the page's question"
    )
    assert.equal((await a("browser_dialog", { target: one.target, id: asked.dialog.id, accept: false })).result, false)
    const told = await a("browser_evaluate", {
      target: one.target,
      expression: "new Promise((resolve) => setTimeout(() => { alert('done'); resolve('returned') }, 0))"
    })
    assert.equal(told.dialog.message, "done", JSON.stringify(told))
    assert.equal(
      (await a("browser_dialog", { target: one.target, id: told.dialog.id, accept: true })).result,
      "returned"
    )
    await waitFor(
      async () => (await panel(`return panel.querySelector('[role=alertdialog]') === null`)) === true,
      "An answered dialog stayed open"
    )
  })

  test("a page may fill the window, and gives it back", async ({ skip }) => {
    // The browser lets a page fill the screen only while its application holds the focus. A run
    // beside someone at work does not take it from them: the step is skipped and says so.
    if ((await ipc("plugin:window|is_focused", { label: "main" })) !== true)
      skip("The test application is not in front, and fullscreen is granted only to the one that is")
    // The request says it is a user's gesture rather than lean on an earlier click.
    const entered = await a("browser_cdp", {
      target: one.target,
      method: "Runtime.evaluate",
      params: {
        userGesture: true,
        awaitPromise: true,
        returnByValue: true,
        expression: "document.documentElement.requestFullscreen().then(() => document.fullscreenElement !== null)"
      }
    })
    assert.equal(entered.result.value, true, JSON.stringify(entered))
    await waitFor(
      async () =>
        (await panel(
          `const box = panel.querySelector('embed').getBoundingClientRect(); return Math.round(box.width) === innerWidth && Math.round(box.height) === innerHeight`
        )) === true,
      "A fullscreen page did not fill the window"
    )
    await evaluate("document.exitFullscreen().then(() => true)")
    await waitFor(
      async () =>
        (await panel(
          `return Math.round(panel.querySelector('embed').getBoundingClientRect().height) < innerHeight`
        )) === true,
      "The page did not return from fullscreen"
    )
  })

  test("an HTTP login is asked in the tab, asked again when wrong, and lets the page in", async () => {
    await ipc("cef_navigate_guest", { label: one.target, url: `${origin}/private` })
    assert.match(
      String(await waitFor(() => login(`return form.textContent`), "No login challenge was shown")),
      /要求登录（Staff）/
    )
    await fill("ada", "wrong")
    await login(`form.requestSubmit(); return true`)
    await waitFor(
      async () =>
        (await login(`return form.querySelector('input[aria-label="密码"]').value === '' ? 'asked again' : ''`)) ===
        "asked again",
      "A wrong password was not asked for again"
    )
    await fill("ada", "s3cret")
    await login(`form.requestSubmit(); return true`)
    await a("browser_wait", { target: one.target, selector: 'body[data-route="/private"]' })
    assert.equal(await login(`return form.textContent`), "")
    await a("browser_navigate", { target: one.target, url: `${origin}/a` })
  })

  test("a load in flight shows real progress, and stop ends it", async () => {
    void a("browser_navigate", { target: one.target, url: `${origin}/slow` }).catch(() => {})
    await waitFor(async () => (await toolbar("停止加载")) === "enabled", "Stop not offered while loading")
    const value = Number(await waitFor(progress, "No native progress while loading"))
    assert.ok(value >= 0 && value < 100, `Progress out of range: ${value}`)
    assert.equal(await toolbar("刷新"), "absent")
    await ipc("cef_guest_history", { label: one.target, action: "stop" })
    await waitFor(async () => (await toolbar("刷新")) === "enabled", "Stop did not end the load")
    assert.equal(await progress(), null)
    releaseSlow?.()
  })

  test("a failed load shows its native error, and the next page clears it", async () => {
    const closed = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") })
    const dead = `http://127.0.0.1:${closed.port}/`
    await closed.stop(true)
    await ipc("cef_navigate_guest", { label: one.target, url: dead }).catch(() => {})
    const failure = String(
      await waitFor(
        () => ui(`document.querySelector('[role=tabpanel]:not([inert]) [role=alert]')?.textContent ?? ''`),
        "Load failure not shown"
      )
    )
    assert.match(failure, /ERR_CONNECTION_REFUSED \(-102\)/)
    assert.ok(failure.includes(dead))
    await ipc("cef_navigate_guest", { label: one.target, url: `${origin}/a` })
    await a("browser_wait", { target: one.target, selector: 'body[data-route="/a"]' })
    await waitFor(
      async () => (await ui(`document.querySelector('[role=tabpanel]:not([inert]) [role=alert]') === null`)) === true,
      "Failure outlived the next navigation"
    )
  })

  test("the page follows the interface zoom on every site", async () => {
    const unzoomed = await viewport()
    await ipc("cef_set_guest_zoom", { scaleFactor: 1.5 })
    await waitFor(
      async () => (await viewport()).ratio === unzoomed.ratio * 1.5,
      "Page did not follow the interface zoom"
    )
    assert.equal((await viewport()).width, Math.round(unzoomed.width / 1.5))
    await a("browser_navigate", { target: one.target, url: `http://localhost:${server.port}/a` })
    await waitFor(async () => (await viewport()).ratio === unzoomed.ratio * 1.5, "Zoom lost on another site")
    await ipc("cef_set_guest_zoom", { scaleFactor: 1 })
    await waitFor(async () => (await viewport()).ratio === unzoomed.ratio, "Page did not return to actual size")
    await assert.rejects(ipc("cef_set_guest_zoom", { scaleFactor: 0 }))
    await a("browser_navigate", { target: one.target, url: `${origin}/a` })
  })

  test("editing chords pressed in the page stay in the page", async () => {
    await a("browser_evaluate", {
      target: one.target,
      expression: "window.seen = []; addEventListener('keydown', (event) => seen.push(event.code), true); true"
    })
    await a("browser_type", { target: one.target, selector: "#draft", text: "中文 draft" })
    await a("browser_press", { target: one.target, selector: "#draft", key: "ControlOrMeta+A" })
    assert.equal(
      (await a("browser_evaluate", { target: one.target, expression: "getSelection().toString()" })).result,
      "中文 draft"
    )
  })

  test("the address chord pressed in the page focuses the address bar, unseen by the page", async () => {
    await chord(76, "KeyL", 37)
    await waitFor(
      async () => (await ui(`document.activeElement?.getAttribute('aria-label')`)) === "网页地址",
      "Cmd+L inside the page did not focus the address bar"
    )
    assert.equal(
      await (
        await a("browser_evaluate", { target: one.target, expression: "document.querySelector('#draft').value" })
      ).result,
      "中文 draft"
    )
    assert.deepEqual(
      (await a("browser_evaluate", { target: one.target, expression: "seen.filter((code) => code === 'KeyL')" }))
        .result,
      []
    )
  })

  test("new-tab and close-tab chords pressed in the page act on the browser", async () => {
    await chord(84, "KeyT", 17)
    await waitFor(async () => (await tabCount()) === baseTabs + 2, "Cmd+T inside the page did not open a tab")
    await chord(87, "KeyW", 13)
    await waitFor(
      async () => !(await a("browser_list")).targets.some((value: any) => value.id === one.target),
      "Cmd+W inside the page did not close its tab"
    )
  })
})
