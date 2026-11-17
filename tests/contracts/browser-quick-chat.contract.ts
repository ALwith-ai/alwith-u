/** Actual QuickChat shell and shared composer over live CEF pages, with an isolated in-process chat double. */
import assert from "node:assert/strict"

import { afterAll, beforeAll, describe, test } from "vitest"

import { conversations, ipc, requireBrowserFixture, rpc, ui, waitFor } from "./lib/app"

describe("browser quick chat", () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response('<title>QuickChat page</title><input aria-label="Page input"><h1>Live page</h1>', {
        headers: { "Content-Type": "text/html" }
      })
  })
  const talks = conversations("quick-chat-foreign")
  let foreign: { target: string }
  let privateGuest: { label: string }
  let sessionId: string
  beforeAll(async () => {
    await requireBrowserFixture()
    await ui(
      'window.__quickChatReload = true; localStorage.removeItem("browser.quickChat.v1"); setTimeout(() => location.reload(), 50); true'
    ).catch((error: unknown) => {
      if (!String(error).includes("document navigated")) throw error
    })
    await waitFor(
      () =>
        ui(
          `window.__quickChatReload === undefined && document.readyState === "complete" && Boolean(document.querySelector('[aria-label="展开浏览器聊天"]:not(:disabled)'))`
        ).catch(() => false),
      "Fresh browser fixture did not load"
    )
    const run = await talks.agent()
    foreign = await run("browser_open", {
      url: `http://127.0.0.1:${server.port}/`
    })
    privateGuest = await ipc("cef_open_guest", {
      url: `http://127.0.0.1:${server.port}/private`,
      private: true
    })
  })
  afterAll(async () => {
    if (privateGuest) await ipc("cef_close_guest", { label: privateGuest.label }).catch(() => {})
    await talks.close()
    await server.stop(true)
  })
  test("expansion uses the existing composer without a page context bar", async () => {
    await ui(`document.querySelector('[aria-label="展开浏览器聊天"]').click()`)
    sessionId = String(
      await waitFor(
        () => ui("document.querySelector('[data-browser-chat-session]')?.dataset.browserChatSession || ''"),
        "Browser session was not created"
      )
    )
    await waitFor(
      () =>
        ui(
          "Boolean(document.querySelector('[data-browser-quick-chat] textarea, [data-browser-quick-chat] [contenteditable=true]'))"
        ),
      "Shared composer did not mount"
    )
    const text = String(await ui("document.querySelector('[data-browser-quick-chat]').textContent"))
    assert.ok(!text.includes("可访问"))
    assert.ok(!text.includes("当前页"))
    assert.ok(!text.includes("选择一个项目文件夹"))
  })
  test("the reused composer sends a plain message without page context", async () => {
    await rpc("fill", {
      window: "main",
      selector: "[data-browser-quick-chat] textarea",
      value: "只发送这句话"
    })
    await waitFor(
      () => ui(`!document.querySelector('[data-browser-quick-chat] [aria-label="发送"]').disabled`),
      "Composer did not accept input"
    )
    await ui(`document.querySelector('[data-browser-quick-chat] [aria-label="发送"]').click()`)
    await waitFor(
      () => ui('document.querySelector("[data-browser-quick-chat]").textContent.includes("浏览器聊天已连接。")'),
      "Composer did not submit to its conversation"
    )
    assert.ok(!(await ui('document.querySelector("[data-browser-quick-chat]").textContent.includes("Live page")')))
  })
  test("the floating conversation can discover foreign and private pages through tools", async () => {
    const result = await ipc("web_automation_execute", {
      sessionId,
      name: "browser_list",
      args: {}
    })
    assert.ok(result.targets.some((target: { id: string }) => target.id === foreign.target))
    assert.ok(result.targets.some((target: { id: string }) => target.id === privateGuest.label))
    const page = await ipc("web_automation_execute", {
      sessionId,
      name: "browser_snapshot",
      args: { target: privateGuest.label }
    })
    assert.ok(JSON.stringify(page).includes("Live page"))
  })
  test.each([
    { side: "left", edge: "top" },
    { side: "right", edge: "top" },
    { side: "left", edge: "bottom" },
    { side: "right", edge: "bottom" }
  ])("native drag docks at $side $edge and resizing stays on one axis", async ({ side, edge }) => {
    const rect = async (selector = "[data-browser-chat-session]") =>
      JSON.parse(
        String(await ui(`JSON.stringify(document.querySelector('${selector}').getBoundingClientRect().toJSON())`))
      )
    const initial = await rect()
    const root = await rect("[data-browser-quick-chat]")
    const left = side === "left" ? root.left + 16 : root.right - initial.width - 16
    const top = edge === "top" ? root.top + 16 : root.bottom - initial.height - 16
    const x = Math.round(initial.left + 100),
      y = Math.round(initial.top + 20)
    const nextX = Math.round(left + 100),
      nextY = Math.round(top + 20)
    await ipc("cef_browser_test_pointer", { phase: "down", x, y })
    await ipc("cef_browser_test_pointer", { phase: "move", x: nextX, y: nextY })
    await ipc("cef_browser_test_pointer", { phase: "up", x: nextX, y: nextY })
    await waitFor(async () => {
      const current = await rect()
      return Math.abs(current.left - left) < 1 && Math.abs(current.top - top) < 1
    }, "Native drag did not settle at its corner")
    assert.equal(await ui(`document.querySelector('[data-quick-chat-resize="corner"]') === null`), true)
    for (const axis of ["width", "height"]) {
      const before = await rect()
      const handle = await rect(`[data-quick-chat-resize="${axis}"]`)
      const x = Math.round(handle.left + handle.width / 2),
        y = Math.round(handle.top + handle.height / 2)
      const dx = side === "right" ? 40 : -40,
        dy = edge === "bottom" ? 30 : -30
      await ipc("cef_browser_test_pointer", { phase: "down", x, y })
      await ipc("cef_browser_test_pointer", { phase: "move", x: x + dx, y: y + dy })
      await ipc("cef_browser_test_pointer", { phase: "up", x: x + dx, y: y + dy })
      await waitFor(async () => (await rect())[axis] < before[axis] - 15, "Native edge resize did not settle")
      const after = await rect()
      assert.ok(Math.abs(axis === "width" ? after.height - before.height : after.width - before.width) < 1)
    }
    await ui(
      `document.querySelector('[data-browser-quick-chat] header > div').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`
    )
    await waitFor(async () => {
      const current = await rect()
      return (
        Math.abs(current.width - initial.width) < 1 &&
        Math.abs(current.right - root.right + 16) < 1 &&
        Math.abs(current.bottom - root.bottom + 16) < 1
      )
    }, "Resize reset did not settle")
  })
  test("keyboard resizing changes the real CEF layout while preserving the docked edge", async () => {
    const rect = () =>
      ui('JSON.stringify(document.querySelector("[data-browser-chat-session]").getBoundingClientRect().toJSON())')
    const before = JSON.parse(String(await rect()))
    await ui(
      `document.querySelector('[data-browser-quick-chat] [aria-label="调整聊天宽度"]').dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))`
    )
    await waitFor(
      async () => JSON.parse(String(await rect())).width > before.width,
      "Keyboard resize did not change width"
    )
    const after = JSON.parse(String(await rect()))
    assert.ok(Math.abs(after.right - before.right) < 1)
    await ui(
      `document.querySelector('[data-browser-quick-chat] header > div').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`
    )
  })
  test("minimizing and restoring retain the same conversation", async () => {
    await ui(`document.querySelector('[aria-label="收起浏览器聊天"]').click()`)
    await waitFor(
      () => ui("Boolean(document.querySelector('[aria-label=\"展开浏览器聊天\"]:not(:disabled)'))"),
      "Chat did not minimize"
    )
    await ui(`document.querySelector('[aria-label="展开浏览器聊天"]').click()`)
    assert.equal(
      await ui("document.querySelector('[data-browser-chat-session]').dataset.browserChatSession"),
      sessionId
    )
  })
  test("new chat replaces the floating conversation and revokes the old full-browser grant", async () => {
    await ui(`document.querySelector('[data-browser-quick-chat] [aria-label="新聊天"]').click()`)
    await waitFor(async () => {
      const id = await ui("document.querySelector('[data-browser-chat-session]')?.dataset.browserChatSession")
      return id && id !== sessionId
    }, "New chat did not replace its predecessor")
    const old = await ipc("web_automation_execute", {
      sessionId,
      name: "browser_list",
      args: {}
    })
    assert.ok(!old.targets.some((target: { id: string }) => target.id === privateGuest.label))
    assert.ok(!old.targets.some((target: { id: string }) => target.id === foreign.target))
  })
})
