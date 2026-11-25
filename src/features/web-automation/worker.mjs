/** Application-owned Playwright executor. This is not an agent or an MCP server. */
import { AsyncLocalStorage } from "node:async_hooks"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"

import { chromium } from "playwright-core"

import { createBrowserTools } from "./engine.mjs"
import { DEFAULT_TIMEOUT_MS, runScript } from "./script-runner.mjs"

/** @param {(url: string, options: import("playwright-core").ConnectOverCDPOptions) => Promise<import("playwright-core").Browser>} connect */
export function createExecutor(connect = chromium.connectOverCDP.bind(chromium), request = fetch, start = runScript) {
  const context = new AsyncLocalStorage()
  const scripts = new Map()
  const sessions = new Map()
  const revoked = new Set()
  const generations = new Map()
  const active = new Map()
  let transport
  const call = async (body) => {
    const message = context.getStore()
    if (!message) throw Error("Missing browser call context")
    const response = await request(message.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${message.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000)
    })
    if (!response.ok) throw Error(`${response.status}: ${await response.text()}`)
    return response.json()
  }
  const run = createBrowserTools(
    call,
    (target) => {
      const url = new URL(transport.endpoint)
      url.protocol = "ws:"
      url.pathname = `/cdp/${encodeURIComponent(target)}`
      return connect(url.href, {
        headers: { Authorization: `Bearer ${transport.token}` },
        noDefaults: true,
        timeout: 15000
      })
    },
    {
      nativeDownloads: true,
      runScript: (target, args) => {
        const { args: call } = context.getStore()
        // The application puts the engine's sandbox state here; a script never runs without one.
        if (call.sandboxState === undefined || call.sandboxState === null)
          throw Error("The engine stated no sandbox for this conversation, so the script was not run")
        const endpoint = new URL(transport.endpoint)
        return start({
          script: args.script,
          code: args.code,
          sandboxState: call.sandboxState,
          tab: {
            host: endpoint.hostname,
            port: Number(endpoint.port),
            path: `/cdp/${encodeURIComponent(target)}`,
            token: transport.token
          },
          launcher: join(dirname(process.execPath), process.platform === "win32" ? "codex.exe" : "codex"),
          runtime: process.execPath,
          shim: join(import.meta.dirname, "script-shim.mjs"),
          timeoutMs: args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          onStart: (stop) => scripts.set(target, stop)
        }).finally(() => scripts.delete(target))
      }
    }
  )
  return {
    async dispatch(message) {
      if (message.version !== 1 || typeof message.sessionId !== "string" || !message.sessionId)
        throw Error("Invalid web automation protocol request")
      const { sessionId } = message
      const token = sessions.get(sessionId)
      if (message.kind === "release" || message.kind === "releaseTarget") {
        if (token && message.token !== token) throw Error("Stale web automation release")
        if (message.kind === "release") {
          revoked.add(message.token)
          sessions.delete(sessionId)
        }
        const results = await Promise.all(
          message.targets.map(async (target) => {
            generations.set(target, (generations.get(target) ?? 0) + 1)
            const pending = active.get(target)
            scripts.get(target)?.()
            const result = await run.release(target)
            if (pending) await Promise.allSettled([pending])
            return { target, ...result }
          })
        )
        return { released: true, targets: results }
      }
      if (message.kind !== "call" || typeof message.token !== "string" || !message.token)
        throw Error("Invalid web automation call")
      if (revoked.has(message.token)) throw Error("Browser turn revoked")
      if (token && token !== message.token) throw Error("Web automation session binding changed")
      const endpoint = new URL(message.endpoint)
      if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1")
        throw Error("Web automation requires the local browser host")
      if (!transport)
        transport = {
          endpoint: message.endpoint,
          token: message.transportToken
        }
      if (transport.endpoint !== message.endpoint || transport.token !== message.transportToken)
        throw Error("Web automation transport binding changed")
      sessions.set(sessionId, message.token)
      const target = message.args?.target
      if (target && active.has(target)) throw Error("Target is busy; await its current tool call before continuing")
      const generation = generations.get(target) ?? 0
      const operation = context.run(message, async () => {
        if (target) await call({ method: "claim", target })
        if (revoked.has(message.token) || generation !== (generations.get(target) ?? 0))
          throw Error("Browser operation canceled before execution")
        return run(message.name, message.args)
      })
      if (target) active.set(target, operation)
      try {
        return await operation
      } finally {
        if (target && active.get(target) === operation) active.delete(target)
      }
    },
    async close() {
      await run.close()
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
