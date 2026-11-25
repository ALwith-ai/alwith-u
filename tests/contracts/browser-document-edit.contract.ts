/**
 * Changing one piece of text in a document editor and nothing else. The document is a Milkdown
 * (ProseMirror) editor, as knowledge bases and wikis use: a heading, a paragraph with emphasis,
 * a paragraph that says a word twice, and a table. Runs in an isolated headless browser.
 */
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"

import { type Browser, chromium } from "playwright-core"
import { afterAll, beforeAll, describe, test } from "vitest"

import { createBrowserTools } from "../../src/features/web-automation/engine.mjs"

describe("editing a document through the browser tools", () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname === "/editor.js") {
        const build = await Bun.build({
          entrypoints: [fileURLToPath(new URL("./fixtures/milkdown/editor.ts", import.meta.url))],
          target: "browser"
        })
        if (!build.success) throw new AggregateError(build.logs, "Milkdown fixture did not build")
        return new Response(build.outputs[0], { headers: { "Content-Type": "text/javascript" } })
      }
      return new Response(
        `<!doctype html><meta charset="utf-8"><p id="shown">只读的 通过</p><div id="editor"></div><script type="module" src="/editor.js"></script>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      )
    }
  })
  let browser: Browser
  let run: ReturnType<typeof createBrowserTools>
  const call = (name: string, args: Record<string, unknown>) => run(name, { target: "document", ...args })
  const text = async (selector: string) =>
    (await call("browser_evaluate", { expression: `document.querySelector(${JSON.stringify(selector)}).textContent` }))
      .result as string
  const editor = "#editor .ProseMirror"

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(server.url.href)
    run = createBrowserTools(
      async () => {
        throw Error("Unexpected native command")
      },
      async () => ({ contexts: () => [context], on() {}, close: () => context.close() }) as unknown as Browser
    )
    await call("browser_wait", { selector: editor })
    await call("browser_wait", { selector: "body[data-ready=true]", state: "attached" })
  })

  afterAll(async () => {
    await run?.close()
    await browser?.close()
    await server.stop(true)
  })

  const paragraphs = async () =>
    (
      await call("browser_evaluate", {
        expression: `[...document.querySelectorAll(${JSON.stringify(`${editor} > p`)})].map((p) => p.textContent)`
      })
    ).result as string[]

  test("emphasised text is replaced and stays emphasised; the rest of the paragraph is as it was", async () => {
    const result = await call("browser_edit_text", { selector: editor, find: "28～52%", replace: "25～51%" })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.before, "笔记写自己占 28～52%，风控 48～72%。")
    assert.equal(result.after, "笔记写自己占 25～51%，风控 48～72%。")
    assert.equal(await text(`${editor} p strong`), "25～51%")
    assert.equal(await text(`${editor} h1`), "错数登记簿")
  })

  test("text that runs across emphasis is replaced as one piece", async () => {
    const result = await call("browser_edit_text", {
      selector: editor,
      find: "占 25～51%，风控",
      replace: "占一半，风控"
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.after, "笔记写自己占一半，风控 48～72%。")
  })

  test("text that is there more than once is not guessed at", async () => {
    await assert.rejects(
      call("browser_edit_text", { selector: editor, find: "通过", replace: "未通过" }),
      /occurs 3 times; pass occurrence, or all[\s\S]*1: …回归：通过，再次通过。…[\s\S]*3: …通过…/
    )
    assert.deepEqual(await paragraphs(), ["笔记写自己占一半，风控 48～72%。", "回归：通过，再次通过。"])
    await assert.rejects(
      call("browser_edit_text", { selector: editor, find: "通过", replace: "未通过", occurrence: 4 }),
      /occurs only 3 times/
    )
  })

  test("the named occurrence changes: a table cell, and nothing in the paragraph above", async () => {
    const result = await call("browser_edit_text", { selector: editor, find: "通过", replace: "未通过", occurrence: 3 })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.before, "通过")
    assert.equal(result.after, "未通过")
    assert.equal(await text(`${editor} tr:last-child td:last-child`), "未通过")
    assert.equal((await paragraphs())[1], "回归：通过，再次通过。")
  })

  test("replacing with nothing deletes the text", async () => {
    const result = await call("browser_edit_text", {
      selector: `${editor} > p:nth-of-type(2)`,
      find: "，再次通过",
      replace: ""
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.after, "回归：通过。")
  })

  test("the editor took each change as its own: undoing brings the text back", async () => {
    await call("browser_press", { selector: editor, key: "ControlOrMeta+Z" })
    assert.equal((await paragraphs())[1], "回归：通过，再次通过。")
  })

  test("a line break after what is there adds a paragraph under it", async () => {
    const result = await call("browser_edit_text", {
      selector: editor,
      find: "再次通过。",
      replace: "再次通过。\n下一步：复核第 4 版。"
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.before, "")
    assert.equal(result.after, "下一步：复核第 4 版。")
    assert.deepEqual(await paragraphs(), [
      "笔记写自己占一半，风控 48～72%。",
      "回归：通过，再次通过。",
      "下一步：复核第 4 版。"
    ])
  })

  test("a line break before what is there adds a paragraph over it", async () => {
    const result = await call("browser_edit_text", { selector: editor, find: "回归：", replace: "临时备注\n回归：" })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.after, "临时备注")
    assert.deepEqual((await paragraphs()).slice(1), ["临时备注", "回归：通过，再次通过。", "下一步：复核第 4 版。"])
  })

  test("deleting all of a paragraph removes the paragraph", async () => {
    const result = await call("browser_edit_text", { selector: editor, find: "临时备注", replace: "" })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.before, "临时备注")
    assert.equal(result.after, "")
    assert.deepEqual(await paragraphs(), [
      "笔记写自己占一半，风控 48～72%。",
      "回归：通过，再次通过。",
      "下一步：复核第 4 版。"
    ])
  })

  test("every occurrence changes at once, in the paragraph and in the table", async () => {
    const result = await call("browser_edit_text", { selector: editor, find: "通过", replace: "PASS", all: true })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.changed, 3)
    assert.equal((await paragraphs())[1], "回归：PASS，再次PASS。")
    assert.equal(await text(`${editor} tr:last-child td:last-child`), "未PASS")
    await assert.rejects(
      call("browser_edit_text", { selector: editor, find: "通过", replace: "x", all: true }),
      /not in the document as written/
    )
  })

  test("selected text is formatted with the editor's own shortcut", async () => {
    const result = await call("browser_select_text", { selector: editor, find: "风控" })
    assert.equal(result.selected, "风控")
    assert.equal(result.in, "笔记写自己占一半，风控 48～72%。")
    await call("browser_press", { selector: editor, key: "ControlOrMeta+B" })
    assert.equal(await text(`${editor} > p:nth-of-type(1) strong`), "风控")
    assert.equal((await paragraphs())[0], "笔记写自己占一半，风控 48～72%。")
  })

  test("text that is not there, or not editable, changes nothing", async () => {
    await assert.rejects(
      call("browser_edit_text", { selector: editor, find: "不存在的字", replace: "x" }),
      /not in the document as written/
    )
    await assert.rejects(
      call("browser_edit_text", { selector: "#shown", find: "通过", replace: "x" }),
      /Nothing here can be edited/
    )
    await assert.rejects(
      call("browser_edit_text", { selector: editor, find: "两段\n文字", replace: "x" }),
      /within one paragraph/
    )
    assert.equal(await text("#shown"), "只读的 通过")
  })
})

/**
 * An editor that builds its paragraphs from plain elements, as many web applications do: nothing
 * in the markup says what a paragraph is, only how the page lays it out.
 */
describe("editing a document whose paragraphs are plain elements", () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(
        `<!doctype html><meta charset="utf-8"><div id="plain" contenteditable="true"><div class="line">第一行 <span style="font-weight:bold">重点</span> 文字</div>
          <div class="line">第二行 文字</div><div class="line"><br></div><div class="line">第四行</div></div>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      )
  })
  let browser: Browser
  let run: ReturnType<typeof createBrowserTools>
  const call = (name: string, args: Record<string, unknown>) => run(name, { target: "document", ...args })
  const lines = async () =>
    (
      await call("browser_evaluate", {
        expression: `[...document.querySelectorAll("#plain > div")].map((line) => line.textContent)`
      })
    ).result as string[]

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(server.url.href)
    run = createBrowserTools(
      async () => {
        throw Error("Unexpected native command")
      },
      async () => ({ contexts: () => [context], on() {}, close: () => context.close() }) as unknown as Browser
    )
    await call("browser_wait", { selector: "#plain" })
  })

  afterAll(async () => {
    await run?.close()
    await browser?.close()
    await server.stop(true)
  })

  test("each laid-out line is a paragraph: text in two of them is two occurrences", async () => {
    await assert.rejects(
      call("browser_edit_text", { selector: "#plain", find: "文字", replace: "内容" }),
      /occurs 2 times[\s\S]*1: …第一行 重点 文字…[\s\S]*2: …第二行 文字…/
    )
    const result = await call("browser_edit_text", { selector: "#plain", find: "文字", replace: "内容", occurrence: 2 })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.before, "第二行 文字")
    assert.equal(result.after, "第二行 内容")
    assert.equal((await lines())[0], "第一行 重点 文字")
  })

  test("text across formatting, a new paragraph and a removed one leave the other lines alone", async () => {
    let result = await call("browser_edit_text", { selector: "#plain", find: "行 重点 文", replace: "行的文" })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.after, "第一行的文字")
    result = await call("browser_edit_text", { selector: "#plain", find: "第四行", replace: "第四行\n第五行" })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.after, "第五行")
    result = await call("browser_edit_text", { selector: "#plain", find: "第二行 内容", replace: "" })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.deepEqual(
      (await lines()).filter((line) => line.trim() !== ""),
      ["第一行的文字", "第四行", "第五行"]
    )
  })
})
