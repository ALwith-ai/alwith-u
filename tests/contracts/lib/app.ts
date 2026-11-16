/** The running application under contract, reached over its Hasgard socket. */
import { connect } from "node:net"

import { chromium } from "playwright-core"

import { createBrowserTools } from "../../../src/features/web-automation/engine.mjs"

const socketPath = process.env.TAURI_HASGARD_SOCKET
if (!socketPath) throw new Error("TAURI_HASGARD_SOCKET is required: contracts run against a launched test application")
let nextId = 0

/** One Hasgard call; the reply is whatever the application answered. */
export function rpc(method: string, params: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath!)
    let buffer = ""
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error("Hasgard timed out"))
    }, 25000)
    socket.on("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    socket.on("connect", () => socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: ++nextId, method, params })}\n`))
    socket.on("data", (data) => {
      buffer += String(data)
      if (!buffer.includes("\n")) return
      clearTimeout(timeout)
      socket.end()
      const reply = JSON.parse(buffer.split("\n")[0]!)
      reply.error ? reject(new Error(JSON.stringify(reply.error))) : resolve(reply.result)
    })
  })
}

/** A command of the application, called as its own main window calls it. */
export const ipc = (command: string, args: unknown = {}) => rpc("ipc", { window: "main", command, args })

/** A script evaluated in the application's main window. */
export const ui = (script: string) => rpc("eval", { window: "main", script })

/** Polls until `check` answers something truthy, and fails with the last answer otherwise. */
export async function waitFor<T>(check: () => Promise<T>, message: string, ms = 10000) {
  const deadline = Date.now() + ms
  let last: unknown
  while (Date.now() < deadline) {
    last = await check()
    if (last) return last as T
    await Bun.sleep(50)
  }
  throw new Error(`${message} (last: ${JSON.stringify(last)})`)
}

/** Fails unless the application shows the isolated browser workspace: contracts never run on a user's own. */
export async function requireBrowserFixture() {
  const page = String(await ui("location.pathname"))
  if (!page.includes("browser-fixture.html")) throw new Error(`Use the isolated browser workspace fixture (at ${page})`)
}

/** The web automation tools bound to a conversation of their own, as an AI conversation has them. */
export type BrowserTools = ReturnType<typeof createBrowserTools>

/**
 * Conversations for one contract. Each `agent()` is a separate conversation with the bundled
 * browser tools; `close()` ends them all and revokes their access.
 */
export function conversations(prefix: string) {
  const sessions: string[] = []
  const runs: BrowserTools[] = []
  return {
    async agent(): Promise<BrowserTools> {
      const descriptor = await ipc("cef_browser_context")
      const sessionId = `${prefix}-${crypto.randomUUID()}`
      sessions.push(sessionId)
      await ipc("cef_browser_bind", { token: descriptor.token, sessionId })
      const env = Object.fromEntries(
        descriptor.env.map((value: { name: string; value: string }) => [value.name, value.value])
      )
      const headers = { Authorization: `Bearer ${env.ALWITH_BROWSER_TOKEN}` }
      const call = async (body: unknown) => {
        const response = await fetch(env.ALWITH_BROWSER_ENDPOINT, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(body)
        })
        if (!response.ok) throw Error(`${response.status}: ${await response.text()}`)
        return response.json()
      }
      const run = createBrowserTools(call, (target) => {
        const url = new URL(env.ALWITH_BROWSER_ENDPOINT)
        url.protocol = "ws:"
        url.pathname = `/cdp/${target}`
        return chromium.connectOverCDP(url.href, { headers, noDefaults: true, timeout: 15000 })
      })
      runs.push(run)
      return run
    },
    async close() {
      await Promise.all(runs.map((run) => run.close()))
      for (const sessionId of sessions) await ipc("cef_browser_revoke", { sessionId }).catch(() => {})
    }
  }
}

/**
 * After a failed step, says what the application was showing: the tabs, the page in front and how
 * large its surface is, and whatever lay over it. Register once in a contract with `afterEach`.
 */
export async function reportFailure(context: { task: { result?: { state?: string } } }) {
  if (context.task.result?.state !== "fail") return
  const shown = await ui(
    `(() => { const panel = document.querySelector('[role=tabpanel]:not([hidden])'); const box = panel?.querySelector('embed')?.getBoundingClientRect(); return JSON.stringify({ tabs: [...document.querySelectorAll('[role=tab]')].map((tab) => (tab.getAttribute('aria-selected') === 'true' ? '>' : '') + tab.textContent), address: panel?.querySelector('input[aria-label="网页地址"]')?.value, surface: box && [Math.round(box.width), Math.round(box.height)], surfaceStyle: panel?.querySelector('embed') && getComputedStyle(panel.querySelector('embed')).visibility + '/' + getComputedStyle(panel.querySelector('embed')).display, alert: panel?.querySelector('[role=alert]')?.textContent, asking: [...(panel?.querySelectorAll('[role=group][aria-label]') ?? [])].map((group) => group.getAttribute('aria-label') + ':' + group.textContent.slice(0, 60)), over: [...document.querySelectorAll('[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[data-slot=popover-content]')].map((layer) => layer.getAttribute('role') + ':' + layer.textContent.slice(0, 80)), focused: document.hasFocus(), fullscreen: document.fullscreenElement !== null }) })()`
  ).catch((error: unknown) => `unreadable: ${String(error)}`)
  console.error(`The application showed: ${String(shown)}`)
}
