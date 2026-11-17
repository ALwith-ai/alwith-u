/** Native application-tool/CDP contract, with an optional isolated real-agent check. */
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { startTestRuntime } from "@alwith/api/node"
import { CodexClient, defineApplicationTool } from "@alwith/module-chat/client"
import { afterAll, beforeAll, describe, test } from "vitest"

import { staged, stagedCodexEngine } from "../../scripts/lib/runtime"
import { tools } from "../../src/features/web-automation/definitions.mjs"
import { ipc, requireBrowserFixture, ui, waitFor } from "./lib/app"

describe("browser application tools", () => {
  const nonce = `CEF_BROWSER_${crypto.randomUUID()}`
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === "/download"
        ? new Response("native download", {
            headers: { "Content-Disposition": 'attachment; filename="native.txt"', "Content-Type": "text/plain" }
          })
        : new Response(
            `<!doctype html><title>Browser CDP fixture</title><h1>${nonce}</h1><input id="entry"><button id="tap" onclick="this.dataset.count=String(Number(this.dataset.count||0)+1)">Test input</button><a href="/download" download>Download</a>`,
            { headers: { "Content-Type": "text/html" } }
          )
  })
  const sessionId = `browser-regression-${crypto.randomUUID()}`
  let guest: { label: string; token: string } | undefined
  let descriptor: any
  let env: Record<string, string>
  const raw = (body: unknown, token = env.ALWITH_BROWSER_TOKEN) =>
    fetch(env.ALWITH_BROWSER_ENDPOINT!, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    })
  const tool = (name: string, args: unknown) => ipc("web_automation_execute", { sessionId, name, args })

  beforeAll(async () => {
    await requireBrowserFixture()
    guest = await ipc("cef_open_guest", { url: `http://127.0.0.1:${server.port}/` })
    await ui(
      `(()=>{const e=document.createElement('embed');e.id='browser-cdp-fixture';e.type='application/x-chromium-surface-embed';e.setAttribute('data-content-id',${JSON.stringify(guest!.token)});e.style='position:fixed;left:32px;top:100px;width:600px;height:240px;z-index:1000';document.body.append(e)})()`
    )
    descriptor = await ipc("cef_browser_context")
    env = Object.fromEntries(descriptor.env.map((entry: { name: string; value: string }) => [entry.name, entry.value]))
  })

  afterAll(async () => {
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
    assert.equal((await raw({ target: "main", method: "downloads" })).status, 404)
    assert.equal((await raw({ target: guest!.label, method: "Browser.close", params: {} })).status, 400)
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

  test("native worker returns upstream refs and verifies their resulting field values", async () => {
    const snapshot = await tool("browser_snapshot", { target: guest!.label })
    const ref = snapshot.text
      .split("\n")
      .find((line: string) => line.includes("textbox"))
      ?.match(/\[ref=([^\]]+)\]/)?.[1]
    assert.ok(ref, snapshot.text)
    await tool("browser_type", {
      target: guest!.label,
      ref,
      snapshotId: snapshot.snapshotId,
      text: "引用验证",
      replace: true
    })
    const result = await tool("browser_verify", {
      target: guest!.label,
      ref,
      snapshotId: snapshot.snapshotId,
      condition: "value",
      expected: "引用验证"
    })
    assert.equal(result.verified, true)
    await tool("browser_reload", { target: guest!.label })
    await assert.rejects(
      tool("browser_click", { target: guest!.label, ref, snapshotId: snapshot.snapshotId }),
      /expired/
    )
  })

  test("structural reads also complete when a guest is hidden", async () => {
    await ui("document.querySelector('#browser-cdp-fixture').style.visibility='hidden'")
    try {
      const snapshot = await tool("browser_snapshot", { target: guest!.label })
      assert.ok(snapshot.text.includes(nonce))
    } finally {
      await ui("document.querySelector('#browser-cdp-fixture').style.visibility='visible'")
    }
  })

  test("native screenshot coordinates act on the same visible CEF target", async () => {
    const capture = await tool("browser_screenshot", { target: guest!.label, selector: "#tap" })
    assert.equal(capture.image.mimeType, "image/png")
    assert.equal(Buffer.from(capture.image.data, "base64").subarray(1, 4).toString(), "PNG")
    await tool("browser_visual", {
      target: guest!.label,
      imageId: capture.imageId,
      action: "click",
      x: capture.region.width / 2,
      y: capture.region.height / 2
    })
    const result = await tool("browser_evaluate", {
      target: guest!.label,
      expression: "document.querySelector('#tap').dataset.count"
    })
    assert.equal(result.result, "1")
    await assert.rejects(
      tool("browser_visual", { target: guest!.label, imageId: capture.imageId, action: "click", x: 1, y: 1 }),
      /expired/
    )
  })

  test("native download saves the designated file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alwith-native-download-"))
    try {
      const path = join(directory, "native.txt")
      const result = await tool("browser_download", { target: guest!.label, selector: "a[download]", path })
      assert.equal(result.ok, true)
      assert.equal(await readFile(path, "utf8"), "native download")
      assert.equal(await readFile(result.sourcePath, "utf8"), "native download")
      await rm(result.sourcePath)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("a revoked credential is refused", async () => {
    await ipc("cef_browser_revoke", { sessionId })
    assert.equal((await raw({ method: "list" })).status, 401)
  })

  test("a new conversation receives existing main-world contexts after reconnect", async () => {
    const reconnected = `${sessionId}-reconnected`
    try {
      const result = await ipc("web_automation_execute", {
        sessionId: reconnected,
        name: "browser_read_page",
        args: { target: guest!.label }
      })
      assert.equal(result.title, "Browser CDP fixture")
      assert.ok(result.text.includes(nonce))
    } finally {
      await ipc("cef_browser_revoke", { sessionId: reconnected })
    }
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
      const client = new CodexClient(() => Promise.resolve(runtime.client), {
        agentId: "codex",
        launch: { engine: "codex", env: { INITIAL_AGENT_MODE: "read-only" } },
        applicationTools: tools.map((definition) =>
          defineApplicationTool({
            ...definition,
            ...(definition.name === "browser_read_page" ? { annotations: { readOnlyHint: true } } : {}),
            parse: (input: unknown) => input,
            execute: async (args, { sessionId }) => ({
              content: [
                {
                  type: "text",
                  text: JSON.stringify(await ipc("web_automation_execute", { sessionId, name: definition.name, args }))
                }
              ]
            })
          })
        )
      })
      try {
        await client.connect()
        const id = await client.prepareDraft("main", runtime.workspace)
        await client.prompt(id, [
          {
            type: "text",
            text: `Use browser_read_page with target ${guest!.label} to read the test page's heading. Reply with that heading only. This is an authorized read-only fixture test. Do not inspect any other target, files or external services.`
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
