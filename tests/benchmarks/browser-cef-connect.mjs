/** Connection gate only: refuses the user's application and never changes its CDP bridge. */
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { chromium } from "playwright-core"

import { ipc, requireBrowserFixture, ui } from "../contracts/lib/app.ts"

assert.ok(process.env.TAURI_HASGARD_SOCKET?.includes("contract-test"), "An isolated contract-test socket is required")
const binary = process.env.AGENT_BROWSER_BIN
assert.ok(binary, "AGENT_BROWSER_BIN is required")
await requireBrowserFixture()
const directory = await mkdtemp(join(tmpdir(), "alwith-cef-connect-"))
const config = join(directory, "agent-browser.json")
await writeFile(config, "{}")
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () =>
    new Response("<title>Isolated connection gate</title><button>Connection evidence</button>", {
      headers: { "Content-Type": "text/html" }
    })
})
const results = []
try {
  for (const kind of ["playwright", "agent-browser"]) {
    const sessionId = `ec-${crypto.randomUUID().slice(0, 8)}`
    const guest = await ipc("cef_open_guest", { url: `http://127.0.0.1:${server.port}` })
    const descriptor = await ipc("cef_browser_context")
    await ipc("cef_browser_bind", { token: descriptor.token, sessionId })
    const env = Object.fromEntries(descriptor.env.map(({ name, value }) => [name, value]))
    const endpoint = new URL(env.ALWITH_BROWSER_ENDPOINT)
    endpoint.protocol = "ws:"
    endpoint.pathname = `/cdp/${guest.label}`
    const headers = { Authorization: `Bearer ${env.ALWITH_BROWSER_TOKEN}` }
    let browser
    let child
    const commandEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_"))
    )
    Object.assign(commandEnv, {
      AGENT_BROWSER_SOCKET_DIR: join(directory, "sockets"),
      AGENT_BROWSER_CDP_HEADERS: JSON.stringify(headers),
      AGENT_BROWSER_DEFAULT_TIMEOUT: "3000"
    })
    const args = [binary, "--config", config, "--session", sessionId, "--json"]
    try {
      await ui(
        `(()=>{const e=document.createElement('embed');e.id='executor-connect';e.type='application/x-chromium-surface-embed';e.setAttribute('data-content-id',${JSON.stringify(guest.token)});e.style='position:fixed;left:32px;top:100px;width:600px;height:240px';document.body.append(e)})()`
      )
      if (kind === "playwright") {
        browser = await chromium.connectOverCDP(endpoint.href, { headers, noDefaults: true, timeout: 5000 })
        const page = browser.contexts()[0].pages()[0]
        const text = await page.ariaSnapshot({ mode: "ai", timeout: 5000 })
        assert.ok(text.includes("Connection evidence"), text)
        results.push({ kind, connected: true, observed: true })
      } else {
        child = Bun.spawn([...args, "--cdp", endpoint.href, "snapshot"], {
          cwd: directory,
          env: commandEnv,
          stdout: "pipe",
          stderr: "pipe"
        })
        const timer = setTimeout(() => child.kill(), 12000)
        try {
          const [stdout, stderr, code] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited
          ])
          // Only fixture data and errors are retained; bearer credentials never enter results.
          results.push({
            kind,
            connected: code === 0,
            observed: code === 0 && stdout.includes("Connection evidence"),
            stdout,
            stderr,
            code
          })
        } finally {
          clearTimeout(timer)
        }
      }
    } catch (error) {
      results.push({ kind, connected: false, error: String(error) })
    } finally {
      await browser?.close()
      if (kind === "agent-browser") {
        const close = Bun.spawn([...args, "close"], {
          cwd: directory,
          env: commandEnv,
          stdout: "ignore",
          stderr: "ignore"
        })
        const timer = setTimeout(() => close.kill(), 5000)
        await close.exited
        clearTimeout(timer)
      }
      await ipc("cef_browser_revoke", { sessionId })
      await ui("document.querySelector('#executor-connect')?.remove()")
      await ipc("cef_close_guest", { label: guest.label })
    }
  }
} finally {
  await server.stop(true)
}
await writeFile(
  join(directory, "results.json"),
  JSON.stringify(
    { scope: "Existing isolated CEF candidate connection gate, not task success comparison", results },
    null,
    2
  )
)
console.log(JSON.stringify(results, null, 2))
console.log(`Evidence: ${directory}`)
