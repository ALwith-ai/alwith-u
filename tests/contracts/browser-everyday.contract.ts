/** Everyday browsing contract: arranging tabs, private tabs, audible tabs and crash recovery. */
import assert from "node:assert/strict"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"

import { $ } from "bun"
import { afterAll, afterEach, beforeAll, describe, test } from "vitest"

import { type BrowserTools, conversations, ipc, reportFailure, requireBrowserFixture, ui, waitFor } from "./lib/app"

// 1x1 red PNG.

const sound = `<title>sound</title><button id="play" onclick="const c=new AudioContext();const o=c.createOscillator();const g=c.createGain();g.gain.value=0.002;o.connect(g).connect(c.destination);o.start();window.quiet=()=>c.close()">play</button>`
// A sign-in form whose title says what its fields hold; with `sign` it signs in by itself.
const login = (
  sign: boolean,
  action = "/welcome"
) => `<title>login</title><form action="${action}"><input name="user" type="email"><input name="pw" type="password"><button>go</button></form><script>
const [user, pw] = document.querySelectorAll("input")
setInterval(() => { document.title = "login " + user.value + "|" + pw.value.length }, 100)
${sign ? 'setTimeout(() => { user.value = "ada@example.com"; pw.value = "correct horse"; document.forms[0].requestSubmit() }, 400)' : ""}
</script>`
// A sign-in the website answers without loading a document: accepted, the form goes; refused, it stays.
const spa = (
  accepts: boolean
) => `<title>spa</title><form><input type="email"><input type="password"><button>go</button></form><script>
const [user, pw] = document.querySelectorAll("input")
document.forms[0].addEventListener("submit", (event) => {
  event.preventDefault()
  setTimeout(() => { ${accepts ? "document.forms[0].remove()" : 'pw.value = ""'}; document.title = "spa answered" }, 300)
})
setTimeout(() => { user.value = "ada@example.com"; pw.value = "correct horse"; document.forms[0].requestSubmit() }, 400)
</script>`
// A sign-up form whose title says how long its two passwords are and whether they agree.
const signup = `<title>signup</title><form><input type="email" value="new@example.com"><input type="password"><input type="password"><button>go</button></form><script>
const [, first, second] = document.querySelectorAll("input")
setInterval(() => { document.title = "signup " + first.value.length + "|" + (first.value === second.value) }, 100)
</script>`
let soundLoads = 0
let refusals = 0
let asked = ""
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/sound") soundLoads += 1
    if (path === "/refused") refusals += 1
    if (path === "/language") asked = request.headers.get("accept-language") ?? ""
    const cookie = request.headers.get("cookie") ?? "none"
    const title = path === "/set" || path === "/show" ? `${path.slice(1)} ${cookie}` : path.slice(1)
    const html =
      path === "/sound"
        ? sound
        : path === "/login"
          ? login(new URL(request.url).searchParams.has("sign"))
          : path === "/signup"
            ? signup
            : path === "/tall"
              ? // Scrolls down and fills its field once; its title says where it is and what the field holds.
                `<title>tall</title><body style="height:6000px"><input id="field"><script>
if (!localStorage.left) { localStorage.left = "1"; setTimeout(() => { scrollTo(0, 1200); field.value = "typed" }, 300) }
setInterval(() => { document.title = "tall " + Math.round(scrollY) + "|" + field.value }, 100)
</script>`
              : path === "/spa"
                ? spa(new URL(request.url).searchParams.has("ok"))
                : path === "/framed"
                  ? `<title>framed</title><iframe src="/login?sign"></iframe>`
                  : path === "/refused"
                    ? // Signs in once, and is shown the form again: the website did not take the password.
                      login(!new URL(request.url).searchParams.has("user"), "/refused")
                    : `<title>${title}</title><body>${path}</body>`
    return new Response(html, {
      headers: { "Content-Type": "text/html", ...(path === "/set" ? { "Set-Cookie": "kept=1; Path=/" } : {}) }
    })
  }
})
const origin = `http://127.0.0.1:${server.port}`
const talks = conversations("everyday-contract")
const visible = `document.querySelector('[role=tabpanel]:not([inert])')`
const strip = `[...document.querySelectorAll('[role=tablist] [role=tab]')]`
/** Close every tab; a pinned one has no close button until it is unpinned. */
const closeTabs = async () => {
  for (;;) {
    const pinned = `${strip}.find((tab) => tab.parentElement.querySelector('button[aria-label^="关闭标签"]') === null)`
    if (!(await ui(`${pinned} !== undefined`))) break
    await ui(
      `${pinned}.parentElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 })), true`
    )
    const item = `[...document.querySelectorAll('[role=menu] [role=menuitem]')].find((item) => item.textContent === '取消固定')`
    await waitFor(() => ui(`${item} !== undefined`), "A pinned tab cannot be unpinned")
    await ui(`${item}.click(), true`)
    await Bun.sleep(200)
  }
  return ui(
    `(() => { for (const button of [...document.querySelectorAll('button[aria-label^="关闭标签"]')]) button.click(); return true })()`
  )
}
const titles = async (): Promise<string[]> =>
  JSON.parse(await ui(`JSON.stringify(${strip}.map((tab) => tab.textContent))`))
const selected = () => ui(`document.querySelector('[role=tab][aria-selected=true]')?.textContent ?? ''`)
const marks = async (name: string) =>
  Number(await ui(`document.querySelectorAll('[role=tab] [aria-label="${name}"]').length`))
const newTab = async () => {
  await ui(`document.querySelector('button[aria-label="新建网页标签"]').click(), true`)
  await waitFor(() => ui(`${visible}.querySelector('embed') !== null`), "A new tab got no browser")
}
const go = async (path: string) => {
  await ui(
    `(() => { const input = ${visible}.querySelector('input[aria-label="网页地址"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(origin + path)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.form.requestSubmit(); return true })()`
  )
  await waitFor(async () => String(await selected()).includes(path.slice(1)), `${path} did not load`)
}
/** Choose an entry of the menu a right click on a tab opens. */
const tabMenu = async (tab: string, entry: string) => {
  // The menu of the tab before may still be closing.
  await waitFor(() => ui(`document.querySelector('[role=menu]') === null`), "A tab's menu stayed open")
  await ui(
    `${strip}.find((tab) => tab.textContent.includes(${JSON.stringify(tab)})).parentElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 })), true`
  )
  const item = `[...document.querySelectorAll('[role=menu] [role=menuitem]')].find((item) => item.textContent === ${JSON.stringify(entry)})`
  await waitFor(() => ui(`${item} !== undefined`), `A tab's menu does not offer ${entry}`)
  await ui(`${item}.click(), true`)
}

describe("everyday browsing", () => {
  let a: BrowserTools
  let heard: any
  // Signing in offers to keep the login; kept, it is filled in when the user comes back.
  const question = () =>
    ui(`${visible}.querySelector('[role=group][aria-label="登录信息保存提示"]')?.textContent ?? ''`)
  // Of this website: an earlier run's logins are under another address.
  const logins = async () => (await ipc("cef_logins")).filter((entry: { origin: string }) => entry.origin === origin)
  // A sign-in the website answers with its form again was refused, and is not offered for keeping.
  const typed = (address: string) =>
    ui(
      `(() => { const input = ${visible}.querySelector('input[aria-label="网页地址"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(origin)} + ${JSON.stringify(address)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.form.requestSubmit(); return true })()`
    )
  // Accepted in place, the form goes and the login is offered; so is one made in a frame of the same website.
  const notNow = () =>
    ui(
      `[...${visible}.querySelectorAll('[role=group][aria-label="登录信息保存提示"] button')].find((button) => button.textContent === '暂不').click(), true`
    )
  // A tab comes back with the pages it had been through: reopened after closing, or copied, it
  // still goes back and forward through them.
  const toolbarButton = (name: string) => `${visible}.querySelector('button[aria-label="${name}"]')`
  const press = async (name: string, lands: string) => {
    await waitFor(() => ui(`${toolbarButton(name)}?.disabled === false`), `${name} is not offered`)
    await ui(`${toolbarButton(name)}.click(), true`)
    await waitFor(async () => String(await selected()).includes(lands), `${name} did not lead to ${lands}`)
  }
  // A tab is found by typing part of its title, among the open ones and the ones closed lately.
  const search = async (text: string) => {
    await ui(`document.querySelector('button[aria-label="搜索标签页"]').click(), true`)
    await waitFor(
      () => ui(`document.querySelector('input[aria-label="搜索标签页"]') !== null`),
      "Tab search did not open"
    )
    await ui(
      `(() => { const input = document.querySelector('input[aria-label="搜索标签页"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`
    )
    return waitFor(
      () =>
        ui(
          `[...document.querySelectorAll('[role=listbox][aria-label="网页标签"] [role=option]')].map((option) => option.textContent).join('|')`
        ),
      `Nothing found for ${text}`
    )
  }
  const pick = () =>
    ui(`document.querySelector('[role=listbox][aria-label="网页标签"] [role=option] button').click(), true`)
  // A page whose process died is said to have crashed, and comes back on request.
  const alert = () => ui(`${visible}.querySelector('[role=alert]')?.textContent ?? ''`)

  beforeAll(async () => {
    await ipc("show_main_window")
    await requireBrowserFixture()
    a = await talks.agent()
    await closeTabs()
  })

  afterEach(reportFailure)

  afterAll(async () => {
    await talks.close()
    await closeTabs().catch(() => {})
    await server.stop(true)
  })

  test("a pinned tab leads the strip and offers no close button", async () => {
    for (const name of ["alpha", "beta", "gamma"]) {
      await newTab()
      await go(`/${name}`)
    }
    await tabMenu("gamma", "固定标签页")
    await waitFor(async () => (await titles())[0]!.includes("gamma"), "A pinned tab did not move to the front")
    assert.equal(
      await ui(`${strip}[0].parentElement.querySelector('button[aria-label^="关闭标签"]') === null`),
      true,
      "A pinned tab still offers its close button"
    )
  })

  test("a tab is duplicated, muted and unmuted from its menu", async () => {
    await tabMenu("alpha", "复制标签页")
    await waitFor(
      async () => (await titles()).filter((title) => title.includes("alpha")).length === 2,
      "Duplicating a tab did not open its page again"
    )
    await tabMenu("beta", "将标签页静音")
    await waitFor(async () => (await marks("已静音")) === 1, "A muted tab does not say so")
    await tabMenu("beta", "取消静音")
    await waitFor(async () => (await marks("已静音")) === 0, "A tab stayed marked muted")
  })

  test("dragging a tab reorders the strip", async () => {
    await ui(
      `(() => { const all = ${strip}; const from = all.find((tab) => tab.textContent.includes('beta')).parentElement; const to = all.find((tab) => tab.textContent.includes('alpha')).parentElement; const data = new DataTransfer(); from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data })); to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data })); to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data })); return true })()`
    )
    await waitFor(async () => {
      const order = await titles()
      return order.findIndex((title) => title.includes("beta")) < order.findIndex((title) => title.includes("alpha"))
    }, "Dragging a tab did not reorder the strip")
    await closeTabs()
  })

  test("a private tab keeps its cookies to itself and is no conversation's to see", async () => {
    await newTab()
    const before = (await a("browser_list")).targets.length
    await ui(`${visible}.querySelector('button[aria-label="浏览器菜单"]').click(), true`)
    const entry = `[...document.querySelectorAll('[role=menuitem]')].find((item) => item.textContent === '新建无痕标签页')`
    await waitFor(() => ui(`${entry} !== undefined`), "The browser menu does not offer a private tab")
    await ui(`${entry}.click(), true`)
    await waitFor(async () => String(await selected()).includes("无痕"), "A private tab does not say it is one")
    await waitFor(() => ui(`${visible}.querySelector('embed') !== null`), "A private tab got no browser")
    await go("/set")
    await go("/show")
    assert.match(String(await selected()), /show kept=1/, "A private tab lost its own cookie")
    assert.equal((await a("browser_list")).targets.length, before, "A conversation can see a private tab")
    await newTab()
    await go("/show")
    assert.match(String(await selected()), /show none/, "A private tab's cookie reached an ordinary tab")
    await closeTabs()
  })

  test("a sign-in is kept only when the user says so, and filled in on return", async () => {
    await newTab()
    await ui(
      `(() => { const input = ${visible}.querySelector('input[aria-label="网页地址"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(`${origin}/login?sign`)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.form.requestSubmit(); return true })()`
    )
    await waitFor(
      async () => String(await question()).includes("ada@example.com"),
      "A sign-in did not offer to be saved"
    )
    assert.deepEqual(await logins(), [], "A login was kept before the user said so")
    await ui(
      `[...${visible}.querySelectorAll('[role=group][aria-label="登录信息保存提示"] button')].find((button) => button.textContent === '保存').click(), true`
    )
    await waitFor(async () => (await question()) === "", "The question stayed after its answer")
    const kept = await logins()
    assert.deepEqual(
      kept.map((entry: { origin: string; username: string }) => [entry.origin, entry.username]),
      [[origin, "ada@example.com"]]
    )
    assert.ok(!JSON.stringify(kept).includes("correct horse"), "A password left the keychain for the interface")
    await go("/login")
    await waitFor(
      async () => String(await selected()).includes("ada@example.com|13"),
      "A saved login was not filled in"
    )
    assert.equal(await question(), "", "A login already kept was asked about again")
    await ipc("cef_delete_login", { origin, username: "ada@example.com" })
  })

  test("a sign-in the website answers with its form again is not offered for keeping", async () => {
    refusals = 0
    await typed("/refused")
    await waitFor(async () => refusals >= 2, "The refused sign-in was not sent")
    await Bun.sleep(4000)
    assert.equal(await question(), "", "A refused sign-in was offered for keeping")
  })

  test("a sign-in refused in place, without a new document, is not offered either", async () => {
    await typed("/spa")
    await waitFor(async () => String(await selected()).includes("spa answered"), "The sign-in was not answered")
    await Bun.sleep(10000)
    assert.equal(await question(), "", "A sign-in refused in place was offered for keeping")
  })

  test("a sign-in accepted in place, or made in a frame of the same website, is offered", async () => {
    for (const address of ["/spa?ok", "/framed"]) {
      await typed(address)
      await waitFor(
        async () => String(await question()).includes("ada@example.com"),
        `A sign-in at ${address} did not offer to be saved`
      )
      await notNow()
      await waitFor(async () => (await question()) === "", "The question stayed after its answer")
    }
  })

  test("the user keeps a login for the website", async () => {
    await typed("/login?sign")
    await waitFor(
      async () => String(await question()).includes("ada@example.com"),
      "A sign-in did not offer to be saved"
    )
    await ui(
      `[...${visible}.querySelectorAll('[role=group][aria-label="登录信息保存提示"] button')].find((button) => button.textContent === '保存').click(), true`
    )
    await waitFor(async () => (await logins()).length === 1, "The login was not kept")
  })

  test("making an account, a strong password is given to both fields that ask for the new one", async () => {
    await go("/signup")
    await ui(`${visible}.querySelector('button[aria-label="网页信息"]').click(), true`)
    const make = `[...document.querySelectorAll('button')].find((button) => button.textContent === '生成强密码并填入')`
    await waitFor(() => ui(`${make} !== undefined`), "Page information does not offer a strong password")
    await ui(`${make}.click(), true`)
    await waitFor(
      async () => String(await selected()).includes("signup 20|true"),
      "A strong password was not filled in"
    )
    await ui(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`)
  })

  test("a saved login is kept from a conversation's tab, whose script has no way to ask", async () => {
    const signIn = await a("browser_open", { url: `${origin}/login` })
    await a("browser_wait", { target: signIn.target, selector: "form" })
    await Bun.sleep(1500)
    assert.equal(
      (await a("browser_evaluate", { target: signIn.target, expression: "document.title" })).result,
      "login |0"
    )
    assert.equal(
      (await a("browser_evaluate", { target: signIn.target, expression: "typeof __alwithLogin + typeof __alwithFill" }))
        .result,
      "undefinedundefined"
    )
    await ipc("cef_delete_login", { origin, username: "ada@example.com" })
    assert.deepEqual(await logins(), [])
    await closeTabs()
  })

  test("another browser's password export is imported, website logins only", async () => {
    const exported = `${tmpdir()}/alwith-u-logins-${process.pid}.csv`
    await Bun.write(
      exported,
      `name,url,username,password,note\nFixture,${origin}/login,grace@example.com,"imported, quoted",\nApp,android://x@y/,grace,pw,\n`
    )
    try {
      assert.equal(await ipc("cef_import_logins", { path: exported }), 1)
    } finally {
      await rm(exported, { force: true })
    }
    assert.deepEqual(
      (await logins()).map((entry: { username: string }) => entry.username),
      ["grace@example.com"]
    )
    await ipc("cef_delete_login", { origin, username: "grace@example.com" })
  })

  test("a website is asked for, and told, the language the user reads", async () => {
    const reads = (await $`defaults read -g AppleLanguages`.text()).match(/[A-Za-z]{2,3}/)![0].toLowerCase()
    const spoken = await a("browser_open", { url: `${origin}/language` })
    const language = String(
      (await a("browser_evaluate", { target: spoken.target, expression: "navigator.language" })).result
    )
    assert.equal(language.split("-")[0], reads, `Pages are told ${language}, the user reads ${reads}`)
    assert.ok(asked.startsWith(language), `Websites are asked for ${asked}, pages are told ${language}`)
    await closeTabs()
  })

  test("an untrusted certificate is explained by the browser's own page, uncovered and not called secure", async () => {
    const keys = `${tmpdir()}/alwith-u-tls-${process.pid}`
    const made = Bun.spawnSync(
      ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=127.0.0.1"].concat([
        "-keyout",
        `${keys}.key`,
        "-out",
        `${keys}.pem`
      ])
    )
    assert.equal(made.exitCode, 0, "A test certificate could not be made")
    const distrusted = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { key: Bun.file(`${keys}.key`), cert: Bun.file(`${keys}.pem`) },
      fetch: () => new Response("<title>reached</title>", { headers: { "Content-Type": "text/html" } })
    })
    try {
      await newTab()
      const address = `https://127.0.0.1:${distrusted.port}/`
      await ui(
        `(() => { const input = ${visible}.querySelector('input[aria-label="网页地址"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(address)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.form.requestSubmit(); return true })()`
      )
      const information = async () => {
        await ui(`${visible}.querySelector('button[aria-label="网页信息"]').click(), true`)
        const text = await waitFor(
          () => ui(`document.querySelector('[data-slot=popover-content]')?.textContent ?? ''`),
          "The page information did not open"
        )
        await ui(
          `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`
        )
        return String(text)
      }
      await waitFor(
        async () => (await information()).includes("此网站的证书不受信任"),
        "A refused certificate is not said to be untrusted"
      )
      // The browser's page has a title of its own; the website's never loaded.
      assert.notEqual(String(await selected()), "", "The browser's certificate warning did not load")
      assert.doesNotMatch(String(await selected()), /reached/, "A page with a refused certificate loaded unasked")
      assert.equal(await ui(`${visible}.querySelector('[role=alert]') === null`), true, "The warning is covered")
    } finally {
      await distrusted.stop(true)
      await rm(`${keys}.key`, { force: true })
      await rm(`${keys}.pem`, { force: true })
    }
    await closeTabs()
  })

  test("a closed tab reopens with its history and still goes back and forward", async () => {
    await newTab()
    await go("/first")
    await go("/second")
    await go("/third")
    await press("后退", "second")
    await waitFor(
      () =>
        ui(
          `JSON.parse(localStorage.getItem('alwith.browser.tabs.v1') ?? '{"tabs":[]}').tabs.some((tab) => tab.history?.entries.length === 3 && tab.history.shown === 1)`
        ),
      "A tab's session history is not saved"
    )
    await closeTabs()
    await ui(
      `document.querySelector('[role=tablist]').dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', key: 't', metaKey: true, shiftKey: true, bubbles: true })), true`
    )
    await waitFor(async () => String(await selected()).includes("second"), "A closed tab did not reopen")
    await press("前进", "third")
    await press("后退", "second")
    await press("后退", "first")
    assert.equal(await ui(`${toolbarButton("后退")}.disabled`), true, "A reopened tab goes back past its first page")
  })

  test("a copied tab keeps the history of the tab it was copied from", async () => {
    await tabMenu("first", "复制标签页")
    await waitFor(async () => (await titles()).length === 2, "A tab was not copied")
    await press("前进", "second")
  })

  test("typing the address of a page another tab shows offers that tab", async () => {
    await ui(
      `(() => { const input = ${visible}.querySelector('input[aria-label="网页地址"]'); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(`${origin.replace("http://", "")}/first`)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`
    )
    const offer = `[...${visible}.querySelectorAll('[role=listbox] [role=option] button')].find((option) => option.textContent.includes('切换到此标签页'))`
    await waitFor(() => ui(`${offer} !== undefined`), "An open page is not offered as its tab")
    await ui(`${offer}.click(), true`)
    await waitFor(async () => String(await selected()) === "first", "Choosing an open page did not show its tab")
    assert.deepEqual(await titles(), ["first", "second"])
  })

  test("a tab is found by part of its title, among open tabs and those closed lately", async () => {
    assert.equal(await search("seco"), "second")
    await pick()
    await waitFor(async () => String(await selected()) === "second", "The tab found was not shown")
    await closeTabs()
    assert.match(String(await search("seco")), /^second最近关闭/)
    await pick()
    await waitFor(async () => String(await selected()).includes("second"), "A closed tab found was not opened again")
    await closeTabs()
  })

  test("a tab comes back as its page was left: scrolled to the same place, its form holding what was typed", async () => {
    await newTab()
    await go("/tall")
    await waitFor(async () => String(await selected()).includes("tall 1200|typed"), "The page did not scroll and fill")
    await waitFor(
      () =>
        ui(
          `JSON.parse(localStorage.getItem('alwith.browser.tabs.v1') ?? '{"tabs":[]}').tabs.some((tab) => typeof tab.history?.entries[tab.history.shown]?.state === 'string')`
        ),
      "The state a page was left in is not kept",
      20000
    )
    await Bun.sleep(7000)
    await closeTabs()
    await ui(
      `document.querySelector('[role=tablist]').dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', key: 't', metaKey: true, shiftKey: true, bubbles: true })), true`
    )
    await waitFor(
      async () => String(await selected()).includes("tall 1200|typed"),
      "A reopened tab did not come back as its page was left"
    )
    await closeTabs()
  })

  test("tabs are kept together under a name that puts them away and brings them back", async () => {
    for (const page of ["/first", "/second", "/third"]) {
      await newTab()
      await go(page)
    }
    const chip = `document.querySelector('[role=tablist] button[aria-label="标签组 未命名"]')`
    await tabMenu("first", "添加到新标签组")
    await waitFor(() => ui(`${chip} !== null`), "A new group has no name to stand behind")
    await tabMenu("third", "添加到标签组“未命名”")
    await waitFor(async () => (await titles()).join() === "first,third,second", "A tab did not join its group's tabs")
    assert.equal(await selected(), "third")
    await ui(`${chip}.click(), true`)
    await waitFor(async () => (await titles()).join() === "second", "A group's tabs were not put away")
    assert.equal(await selected(), "second", "Putting a group away left its tab in front")
    await waitFor(
      () =>
        ui(
          `(() => { const saved = JSON.parse(localStorage.getItem('alwith.browser.tabs.v1') ?? '{}'); return saved.groups?.length === 1 && saved.groups[0].collapsed === true && saved.tabs.filter((tab) => tab.group === 0).length === 2 })()`
        ),
      "A group is not kept with its tabs"
    )
    await ui(`${chip}.click(), true`)
    await waitFor(async () => (await titles()).length === 3, "A group's tabs did not come back")
    await tabMenu("first", "从标签组中移除")
    await waitFor(async () => (await titles()).join() === "third,first,second", "A tab did not leave its group")
    await closeTabs()
    assert.equal(await ui(`${chip} === null`), true, "A group outlived its tabs")
  })

  test("a tab that is heard says so, and stops when it falls silent", async () => {
    heard = await a("browser_open", { url: `${origin}/sound` })
    await a("browser_wait", { target: heard.target, selector: "#play" })
    assert.equal(await marks("正在播放声音"), 0)
    await a("browser_click", { target: heard.target, selector: "#play" })
    await waitFor(async () => (await marks("正在播放声音")) === 1, "A tab playing audio does not say so")
    await a("browser_evaluate", { target: heard.target, expression: "window.quiet(), true" })
    await waitFor(async () => (await marks("正在播放声音")) === 0, "A silent tab still says it is heard", 15000)
  })

  test("a crashed page is said to have crashed, and comes back on request", async () => {
    void a("browser_cdp", { target: heard.target, method: "Page.crash", params: {} }).catch(() => {})
    await waitFor(async () => String(await alert()).includes("此网页已崩溃"), "A crashed page is not reported")
    const loads = soundLoads
    await ui(`${visible}.querySelector('[role=alert] button').click(), true`)
    await waitFor(async () => (await alert()) === "", "The crash report stayed after reloading")
    await waitFor(async () => soundLoads > loads, "A crashed page was not loaded again")
  })
})
