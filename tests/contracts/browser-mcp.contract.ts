/**
 * Native MCP/CDP contract: the bundled browser server as a conversation runs it. The last step
 * drives a real conversation and runs only with BROWSER_AI_LIVE=1, which uses the user's Codex login.
 */
import assert from "node:assert/strict"
import { homedir } from "node:os"
import { join } from "node:path"

import { startTestRuntime } from "@alwith/api/node"
import { afterAll, beforeAll, describe, test } from "vitest"

import { staged, stagedCodexEngine } from "../../scripts/lib/runtime"
import { CodexClient } from "../../src/agent/client"
import { ipc, ui, waitFor } from "./lib/app"

describe("browser tools over MCP", () => {
  const nonce = `CEF_BROWSER_${crypto.randomUUID()}`
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(
        `<!doctype html><title>Browser CDP fixture</title><h1>${nonce}</h1><input id="entry"><button id="tap" onclick="this.dataset.count=String(Number(this.dataset.count||0)+1)">Test input</button>`,
        { headers: { "Content-Type": "text/html" } }
      )
  })
  const sessionId = `browser-regression-${crypto.randomUUID()}`
  let guest: { label: string; token: string } | undefined
  let child: Bun.Subprocess<"pipe", "pipe", "inherit"> | undefined
  let descriptor: any
  let env: Record<string, string>
  let reader: ReadableStreamDefaultReader<Uint8Array>
  let output = ""
  let nextId = 0
  const raw = (body: unknown, token = env.ALWITH_BROWSER_TOKEN) =>
    fetch(env.ALWITH_BROWSER_ENDPOINT!, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    })
  async function mcp(method: string, params: unknown = {}): Promise<any> {
    const id = ++nextId
    void child!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
    while (!output.includes("\n")) {
      const next = await reader.read()
      assert.ok(!next.done, "MCP process exited")
      output += new TextDecoder().decode(next.value)
    }
    const line = output.slice(0, output.indexOf("\n"))
    output = output.slice(output.indexOf("\n") + 1)
    const reply = JSON.parse(line)
    assert.equal(reply.id, id)
    assert.ok(!reply.error)
    return reply.result
  }
  async function tool(name: string, args: unknown) {
    const result = await mcp("tools/call", { name, arguments: args })
    assert.ok(!result.isError, JSON.stringify(result))
    return JSON.parse(result.content[0].text)
  }

  beforeAll(async () => {
    guest = await ipc("cef_open_guest", { url: `http://127.0.0.1:${server.port}/` })
    await ui(
      `(()=>{const e=document.createElement('embed');e.id='browser-cdp-fixture';e.type='application/x-chromium-surface-embed';e.setAttribute('data-content-id',${JSON.stringify(guest!.token)});e.style='position:fixed;left:32px;top:100px;width:600px;height:240px;z-index:1000';document.body.append(e)})()`
    )
    descriptor = await ipc("cef_browser_context")
    env = Object.fromEntries(descriptor.env.map((entry: { name: string; value: string }) => [entry.name, entry.value]))
  })

  afterAll(async () => {
    child?.kill()
    await ipc("cef_browser_revoke", { sessionId }).catch(() => {})
    await ui("document.querySelector('#browser-cdp-fixture')?.remove()").catch(() => {})
    if (guest) await ipc("cef_close_guest", { label: guest.label }).catch(() => {})
    await server.stop(true)
  })

  test("a credential is refused until its conversation is bound, and a wrong one always", async () => {
    assert.equal((await raw({ method: "list" })).status, 401)
    await ipc("cef_browser_bind", { token: descriptor.token, sessionId })
    assert.equal((await raw({ method: "list" }, "wrong-token")).status, 401)
  })

  test("the application's own window and browser-wide commands are refused", async () => {
    assert.equal((await raw({ target: "main", method: "DOM.getDocument", params: {} })).status, 404)
    assert.equal((await raw({ target: guest!.label, method: "Browser.close", params: {} })).status, 400)
  })

  test("the bundled server introduces itself and lists its tools", async () => {
    child = Bun.spawn([descriptor.command, ...descriptor.args], {
      env: { ...process.env, ...env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit"
    })
    reader = child.stdout.getReader()
    const hello = await mcp("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "native-regression", version: "1" }
    })
    assert.equal(hello.serverInfo.name, "alwith-cef-browser")
    assert.ok((await mcp("tools/list")).tools.some((entry: any) => entry.name === "browser_cdp"))
  })

  test("its tools list the tab and read the live page", async () => {
    assert.ok((await tool("browser_list", {})).targets.some((target: any) => target.id === guest!.label))
    await waitFor(
      async () => (await tool("browser_read_page", { target: guest!.label })).text.includes(nonce),
      "The page's live content was not read",
      6000
    )
  })

  test("its tools click and type Chinese", async () => {
    await tool("browser_click", { target: guest!.label, selector: "#tap" })
    await tool("browser_type", { target: guest!.label, selector: "#entry", text: "你好 CDP", replace: true })
    const state = await tool("browser_cdp", {
      target: guest!.label,
      method: "Runtime.evaluate",
      params: {
        expression:
          "({value:document.querySelector('#entry').value,count:document.querySelector('#tap').dataset.count})",
        returnByValue: true
      }
    })
    assert.deepEqual(state.result.value, { value: "你好 CDP", count: "1" })
  })

  test("a revoked credential is refused", async () => {
    await ipc("cef_browser_revoke", { sessionId })
    assert.equal((await raw({ method: "list" })).status, 401)
  })

  test.skipIf(process.env.BROWSER_AI_LIVE !== "1")(
    "a real conversation calls the browser tool and answers with what the page says",
    async () => {
      await using runtime = await startTestRuntime({
        binary: staged("alwith-runtime"),
        engines: { codex: stagedCodexEngine() },
        transport: "stdio",
        authFrom: process.env.CODEX_HOME ?? join(homedir(), ".codex")
      })
      const ai = await ipc("cef_browser_context")
      const client = new CodexClient(() => Promise.resolve(runtime.client), {
        agentId: "codex",
        launch: { engine: "codex", env: { INITIAL_AGENT_MODE: "read-only" } },
        sessionContext: async () => ({
          mcpServers: [{ type: "stdio", name: "embedded_browser", command: ai.command, args: ai.args, env: ai.env }],
          bind: (sessionId) => ipc("cef_browser_bind", { token: ai.token, sessionId })
        })
      })
      try {
        await client.connect()
        const id = await client.prepareDraft("main", runtime.workspace)
        await client.prompt(id, [
          {
            type: "text",
            text: `Use embedded_browser browser_read_page with target ${guest!.label} to read the test page's heading. Reply with that heading only. This is an authorized read-only fixture test. Do not inspect any other target, files or external services.`
          }
        ])
        const deadline = Date.now() + 120000
        while (client.session(id).state !== "idle" && Date.now() < deadline) {
          for (const action of client.state.actions) {
            if (
              action.sessionId === id &&
              JSON.stringify(action).includes("browser_read_page") &&
              JSON.stringify(action).includes(guest!.label)
            ) {
              client.respond(action.id, { outcome: { outcome: "selected", optionId: "allow_once" } })
            }
          }
          await Bun.sleep(100)
        }
        const items = client.session(id).items
        const answer = items
          .flatMap((item) => (item.kind === "assistant" ? item.content : []))
          .flatMap((block) => (block.type === "text" && "text" in block ? [String(block.text)] : []))
          .join("")
        assert.ok(
          answer.includes(nonce),
          `AI did not return the fixture nonce: ${JSON.stringify({ state: client.session(id).state, items })}`
        )
        assert.ok(
          items.some((item) => item.kind === "tool" && item.status === "completed"),
          "AI produced no successful tool call"
        )
        await ipc("cef_browser_revoke", { sessionId: id })
      } finally {
        client.disconnect()
      }
    },
    180000
  )
})
