/** Native Playwright regression against an isolated Hasgard candidate; no agent or user profile. */
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type Browser, chromium, type Page } from "playwright-core"
import { createServer, type ViteDevServer } from "vite"
import { afterAll, beforeAll, describe, test } from "vitest"

import { createBrowserTools } from "../../scripts/browser-mcp.mjs"
import { type BrowserTools, ipc, ui, waitFor } from "./lib/app"

describe("browser automation", () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/fail") return new Response("fixture failure", { status: 503 })
      if (new URL(request.url).pathname === "/frame")
        return new Response("<button onclick=\"this.textContent='Frame done'\">Frame action</button>", {
          headers: { "Content-Type": "text/html" }
        })
      return new Response(
        `<!doctype html><title>Playwright guest fixture</title>
    <label>Message<input id="entry"></label><button id="tap" onclick="this.textContent='Clicked';console.log('fixture clicked')">Delayed action</button>
    <div id="cover" style="position:fixed;inset:0;z-index:10;background:white">Loading</div>
    <iframe src="http://localhost:${new URL(request.url).port}/frame"></iframe><script>setTimeout(()=>document.querySelector('#cover').remove(),1500)</script>`,
        { headers: { "Content-Type": "text/html" } }
      )
    }
  })
  const sessionId = `playwright-test-${crypto.randomUUID()}`
  let fixture: string
  let vite: ViteDevServer
  let viteUrl: string
  let guest: { label: string; token: string } | undefined
  let run: BrowserTools
  let browser: Browser | undefined
  let descriptor: any
  let env: Record<string, string>
  let headers: { Authorization: string }
  let endpoint: URL
  let target: string
  let page: Page
  const connect = (url: URL, timeout: number) =>
    chromium.connectOverCDP(url.href, { headers, noDefaults: true, timeout })
  const call = async (body: unknown) => {
    const response = await fetch(env.ALWITH_BROWSER_ENDPOINT!, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
    if (!response.ok) throw Error(await response.text())
    return response.json()
  }

  beforeAll(async () => {
    await ipc("plugin:window|show", { label: "main" })
    const shown = String(await ui("location.pathname"))
    assert.ok(
      ["native-shell-test.html", "browser-fixture.html"].some((path) => shown.includes(path)),
      "Use an isolated native shell candidate, never a normal user session"
    )
    // A small website served by Vite, to edit while the page is open.
    fixture = await mkdtemp(join(tmpdir(), "alwith-webdev-"))
    await writeFile(
      join(fixture, "index.html"),
      '<title>Vite guest fixture</title><input id="preserved"><div id="version" class="panel"></div><script type="module" src="/main.js"></script>'
    )
    await writeFile(
      join(fixture, "main.js"),
      `import '/ui.css';import { value } from '/value.js';document.querySelector('#version').textContent=value;import.meta.hot.accept('/value.js',m=>document.querySelector('#version').textContent=m.value)`
    )
    await writeFile(join(fixture, "value.js"), 'export const value="before"')
    await writeFile(join(fixture, "ui.css"), ".panel { width:80px }")
    vite = await createServer({
      configFile: false,
      root: fixture,
      server: { host: "127.0.0.1", port: 0 },
      logLevel: "error"
    })
    await vite.listen()
    const address = vite.httpServer!.address()
    assert.ok(address && typeof address !== "string")
    viteUrl = `http://127.0.0.1:${address.port}`

    guest = await ipc("cef_open_guest", { url: `http://127.0.0.1:${server.port}/` })
    await ui(
      `(()=>{const e=document.createElement('embed');e.id='pw-fixture';e.type='application/x-chromium-surface-embed';e.setAttribute('data-content-id',${JSON.stringify(guest!.token)});e.style='position:fixed;left:32px;top:100px;width:700px;height:450px;z-index:1000';document.body.append(e)})()`
    )
    target = guest!.label
    descriptor = await ipc("cef_browser_context")
    env = Object.fromEntries(descriptor.env.map((v: { name: string; value: string }) => [v.name, v.value]))
    headers = { Authorization: `Bearer ${env.ALWITH_BROWSER_TOKEN}` }
    endpoint = new URL(env.ALWITH_BROWSER_ENDPOINT!)
    endpoint.protocol = "ws:"
    endpoint.pathname = `/cdp/${target}`
  })

  afterAll(async () => {
    await run?.close()
    await browser?.close().catch(() => {})
    if (guest) await ipc("cef_close_guest", { label: guest.label }).catch(() => {})
    await ui("document.querySelector('#pw-fixture')?.remove()").catch(() => {})
    await ipc("cef_browser_revoke", { sessionId }).catch(() => {})
    await server.stop(true)
    await vite?.close()
    if (fixture) await rm(fixture, { recursive: true, force: true })
  })

  test("a connection is refused until its conversation is bound", async () => {
    await assert.rejects(connect(endpoint, 3000), /401/)
    await ipc("cef_browser_bind", { token: descriptor.token, sessionId })
  })

  test("the application's own window is no target", async () => {
    const shell = new URL(endpoint)
    shell.pathname = "/cdp/main"
    await assert.rejects(connect(shell, 3000), /404/)
  })

  test("the bundled tools read, click after waiting and type Chinese through official Playwright", async () => {
    run = createBrowserTools(call, async () => {
      browser = await connect(endpoint, 15000)
      return browser
    })
    assert.equal((await run("browser_read_page", { target })).title, "Playwright guest fixture")
    // The button is covered for a while: the click waits for it.
    await run("browser_click", { target, selector: 'role=button[name="Delayed action"]' })
    await run("browser_type", { target, selector: "#entry", text: "中文 Playwright", replace: true })
    page = browser!.contexts()[0]!.pages()[0]!
    assert.equal(await page.locator("#entry").inputValue(), "中文 Playwright")
    assert.equal(await page.locator("#tap").innerText(), "Clicked")
  })

  test("a frame from another origin is acted on", async () => {
    await page.frameLocator("iframe").getByRole("button", { name: "Frame action" }).click()
    assert.equal(await page.frameLocator("iframe").locator("button").innerText(), "Frame done")
  })

  test("a second connection is refused while the first holds the page", async () => {
    // Repeated rejected connections must not release the incumbent lease.
    for (let attempt = 0; attempt < 3; attempt++) await assert.rejects(connect(endpoint, 3000), /409/)
    assert.equal(await page.title(), "Playwright guest fixture")
    const evaluated = await run("browser_evaluate", { target, expression: "document.querySelector('#entry').value" })
    assert.equal(evaluated.result, "中文 Playwright")
  })

  test("raw protocol methods answer with the page's metrics", async () => {
    const metrics = await run("browser_cdp", { target, method: "Page.getLayoutMetrics" })
    assert.ok(metrics.cssLayoutViewport.clientWidth > 0)
  })

  test("console output, failed requests and page errors reach diagnostics", async () => {
    assert.ok((await run("browser_diagnostics", { target })).messages.some((m: any) => m.text === "fixture clicked"))
    const failedResponse = page.waitForResponse((response) => response.url().endsWith("/fail"))
    await page.evaluate(() => {
      void fetch("/fail")
      setTimeout(() => {
        throw Error("fixture exception")
      }, 0)
    })
    await failedResponse
    await waitFor(
      async () => {
        const { messages } = await run("browser_diagnostics", { target })
        return (
          messages.some((m: any) => m.type === "http" && m.status === 503) &&
          messages.some((m: any) => m.type === "pageerror" && m.text.includes("fixture exception"))
        )
      },
      "Console and network diagnostics were not delivered",
      5000
    )
  })

  test("a request is answered by a route set through Playwright", async () => {
    await page.route("**/mock-api", (route) => route.fulfill({ json: { source: "playwright" } }))
    assert.equal(await page.evaluate(async () => (await (await fetch("/mock-api")).json()).source), "playwright")
    await page.unroute("**/mock-api")
  })

  test("a selector matching several elements is refused", async () => {
    await assert.rejects(run("browser_click", { target, selector: "button, input" }), /strict mode violation/)
  })

  test("a stylesheet edited on disk restyles the open page", async () => {
    await run("browser_navigate", { target, url: viteUrl })
    await run("browser_wait", { target, selector: '#version:text-is("before")' })
    assert.equal((await run("browser_inspect", { target, selector: "#version" })).box.width, 80)
    await writeFile(join(fixture, "ui.css"), ".panel { width:160px }")
    await page.waitForFunction(() => document.querySelector("#version")?.getBoundingClientRect().width === 160)
    assert.equal((await run("browser_inspect", { target, selector: "#version" })).box.width, 160)
  })

  test("a module edited on disk is replaced without losing what was typed", async () => {
    await run("browser_type", { target, selector: "#preserved", text: "keep through HMR", replace: true })
    await writeFile(join(fixture, "value.js"), 'export const value="after"')
    await run("browser_wait", { target, selector: '#version:text-is("after")' })
    assert.equal(await page.locator("#preserved").inputValue(), "keep through HMR")
  })

  test("reload, back and forward move the page", async () => {
    await run("browser_reload", { target })
    await run("browser_wait", { target, selector: '#version:text-is("after")' })
    await run("browser_back", { target })
    assert.equal(await page.title(), "Playwright guest fixture")
    await run("browser_forward", { target })
    assert.equal(await page.title(), "Vite guest fixture")
    await run("browser_back", { target })
  })

  test("a method that reaches beyond the page is refused", async () => {
    await assert.rejects(call({ target, method: "Browser.close" }), /outside/)
    await run.close()
  })

  test("the bundled entry answers tool calls when run by the bundled Bun", async () => {
    // Execute the exact bundled entry with bundled Bun, not a source-tree import.
    const child = Bun.spawn([descriptor.command, ...descriptor.args], {
      env: { ...process.env, ...env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    })
    try {
      const ask = (id: number, name: string, args: Record<string, unknown>) =>
        void child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}\n`
        )
      ask(1, "browser_read_page", { target })
      ask(2, "browser_reload", { target })
      ask(3, "browser_evaluate", { target, expression: "document.title" })
      void child.stdin.end()
      const [output, errors, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited
      ])
      assert.equal(code, 0, errors)
      const replies = output
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      assert.equal(replies.length, 3)
      for (const reply of replies) assert.ok(!reply.result.isError, JSON.stringify(reply))
      assert.equal(JSON.parse(replies[0].result.content[0].text).title, "Playwright guest fixture")
      assert.equal(JSON.parse(replies[2].result.content[0].text).result, "Playwright guest fixture")
    } finally {
      child.kill()
    }
  })

  test("revoking the conversation drops its connection", async () => {
    browser = await connect(endpoint, 15000)
    await ipc("cef_browser_revoke", { sessionId })
    await waitFor(async () => !browser!.isConnected(), "The connection outlived its conversation", 5000)
  })
})
