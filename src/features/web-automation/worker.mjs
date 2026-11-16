/** Application-owned Playwright executor. This is not an agent or an MCP server. */
import { createInterface } from "node:readline"

import { chromium } from "playwright-core"

import { createBrowserTools } from "./engine.mjs"

export function createExecutor(connect = chromium.connectOverCDP.bind(chromium), request = fetch) {
  const sessions = new Map()
  return {
    async dispatch(message) {
      if (message.version !== 1 || typeof message.sessionId !== "string" || !message.sessionId)
        throw Error("Invalid web automation protocol request")
      const { sessionId } = message
      if (message.kind === "release") {
        const entry = sessions.get(sessionId)
        if (entry && message.token !== entry.token) throw Error("Stale web automation release")
        sessions.delete(sessionId)
        await entry?.run.close()
        return { released: true }
      }
      if (message.kind !== "call" || typeof message.token !== "string" || !message.token)
        throw Error("Invalid web automation call")
      let entry = sessions.get(sessionId)
      if (entry && (entry.token !== message.token || entry.endpoint !== message.endpoint))
        throw Error("Web automation session binding changed")
      if (!entry) {
        const endpoint = new URL(message.endpoint)
        if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1")
          throw Error("Web automation requires the local browser host")
        const headers = { Authorization: `Bearer ${message.token}` }
        const run = createBrowserTools(
          async (body) => {
            const response = await request(endpoint, {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(25000)
            })
            if (!response.ok) throw Error(`${response.status}: ${await response.text()}`)
            return response.json()
          },
          (target) => {
            const url = new URL(endpoint)
            url.protocol = "ws:"
            url.pathname = `/cdp/${encodeURIComponent(target)}`
            return connect(url.href, { headers, noDefaults: true, timeout: 15000 })
          },
          { nativeDownloads: true }
        )
        entry = { token: message.token, endpoint: message.endpoint, run }
        sessions.set(sessionId, entry)
      }
      return entry.run(message.name, message.args)
    },
    async close() {
      const entries = [...sessions.values()]
      sessions.clear()
      await Promise.allSettled(entries.map(({ run }) => run.close()))
    }
  }
}

if (import.meta.main) {
  const executor = createExecutor()
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  // Requests from different conversations must not block one another.
  lines.on("line", (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      process.stderr.write("Invalid web automation frame\n")
      return
    }
    void executor.dispatch(message).then(
      (result) => process.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`),
      (error) => process.stdout.write(`${JSON.stringify({ id: message.id, error: String(error) })}\n`)
    )
  })
  lines.on("close", () => void executor.close())
}
