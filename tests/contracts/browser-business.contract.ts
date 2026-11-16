/** Business workflows through the same browser tools used by conversations, without computer use. */
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { chromium } from "playwright-core"
import { afterAll, afterEach, beforeAll, describe, test } from "vitest"

import { createBrowserTools } from "../../scripts/browser-mcp.mjs"

interface DialogState {
  id: number
  message: string
}
interface ActionResult {
  ok: boolean
  pending?: boolean
  dialog?: DialogState
  result?: unknown
}
interface ToolResults {
  browser_read_page: {
    text: string
    nextOffset: number | null
    accessibility: string
    dialog?: DialogState
    frames: { id: string; parent: string | null }[]
    fileInputs: { id: string }[]
  }
  browser_read_elements: {
    total: number
    nextOffset: number | null
    elements: { text: string; value?: string; checked?: boolean; files?: { name: string }[] }[]
  }
  browser_click: ActionResult
  browser_dialog: ActionResult
  browser_type: ActionResult & { matchesRequestedText?: boolean; value?: string }
  browser_evaluate: ActionResult
  browser_scroll: { y: number }
  browser_wait: ActionResult
  browser_upload: unknown
  browser_check: unknown
  browser_hover: unknown
  browser_double_click: unknown
  browser_drag: unknown
}

describe("website business workflows", () => {
  let run: ReturnType<typeof createBrowserTools>
  let target: string
  let cleanup: () => Promise<void>
  let directory: string
  let attachment: string
  let frame: string
  let submissions = 0
  let submitted: { text: string; filename: string; content: string } | undefined
  const editor = `<title>Message editor</title><div role="textbox" aria-label="Reply" contenteditable="true"></div>
    <input id="attachment" type="file" hidden><button id="send">Send reply</button><p role="status"></p>
    <button id="reference" onclick="if(confirm('Continue?'))this.textContent=prompt('Reference')">Set reference</button>
    <script>document.querySelector('#send').onclick=async()=>{
      if(!confirm('Send this reply?')) return;
      const data=new FormData();data.set('text',document.querySelector('[role=textbox]').innerText);
      const file=document.querySelector('#attachment').files[0];if(file)data.set('file',file);
      const response=await fetch('/send',{method:'POST',body:data});
      document.querySelector('[role=status]').textContent=response.ok?'Reply sent':'Send failed';
    }</script>`
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url)
      if (url.pathname === "/send") {
        const data = await request.formData()
        const file = data.get("file") as File
        const text = data.get("text")
        assert.equal(typeof text, "string")
        submissions++
        submitted = {
          text: (text as string).replaceAll("\r\n", "\n"),
          filename: file.name,
          content: await file.text()
        }
        return new Response("saved")
      }
      const html =
        url.pathname === "/editor"
          ? editor
          : `<!doctype html><title>Business workspace</title>
        <h1>Customer request</h1><article>${"Thread detail. ".repeat(1500)}END OF THREAD</article>
        <iframe title="Reply editor" src="http://localhost:${server.port}/editor"></iframe>
        <label><input type="checkbox" id="approved">Approved</label>
        <input type="password" value="never-return-this-password">
        <div id="menu">Actions<button id="archive" style="display:none" onclick="this.textContent='Archived'">Archive</button></div>
        <div id="cell" ondblclick="this.contentEditable='true';this.focus()">Old cell</div>
        <div id="rows" style="height:80px;overflow:auto"><div style="height:1000px">First rows</div><p>Last row</p></div>
        <div id="drag" style="width:150px;height:50px;user-select:none" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','Task card')">Task card</div><div id="drop" style="height:80px" ondragover="event.preventDefault()" ondrop="event.preventDefault();this.textContent='Moved'">Backlog</div>
        <script>document.querySelector('#menu').onmouseenter=()=>document.querySelector('#archive').style.display='block'</script>`
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
    }
  })
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "alwith-business-"))
    attachment = join(directory, "reply.txt")
    await Bun.write(attachment, "Attachment content 附件")
    const url = `http://127.0.0.1:${server.port}/`
    if (process.env.BROWSER_BUSINESS_HEADLESS === "1") {
      const browser = await chromium.launch({ headless: true })
      cleanup = () => browser.close()
      const page = await browser.newPage()
      await page.goto(url)
      target = "isolated-chromium"
      run = createBrowserTools(
        () => Promise.reject(Error("Native route is not part of the Chromium-only test")),
        () => Promise.resolve(browser)
      )
      cleanup = () => run.close()
    } else {
      const { conversations, requireBrowserFixture } = await import("./lib/app")
      await requireBrowserFixture()
      const talks = conversations("business-workflows")
      cleanup = () => talks.close()
      run = await talks.agent()
      const opened = (await run("browser_open", { url })) as { target: string }
      target = opened.target
      assert.ok(target, JSON.stringify(opened))
      cleanup = async () => {
        try {
          await run("browser_close", { target })
        } finally {
          await talks.close()
        }
      }
    }
  })
  afterEach(async ({ task }) => {
    if (task.result?.state !== "fail") return
    console.error(
      "animation frames",
      await run("browser_evaluate", {
        target,
        frame,
        expression:
          "new Promise(resolve=>{let n=0;function tick(){n++;if(n<30)requestAnimationFrame(tick)}requestAnimationFrame(tick);setTimeout(()=>resolve(n),500)})"
      })
    )
    console.error(
      await run("browser_evaluate", {
        target,
        frame,
        expression:
          "({hidden:document.hidden,visibility:document.visibilityState,active:document.activeElement?.tagName,rect:document.querySelector('[role=textbox]')?.getBoundingClientRect().toJSON(),viewport:[innerWidth,innerHeight]})"
      })
    )
    console.error(
      await run("browser_evaluate", {
        target,
        expression:
          "({hidden:document.hidden,focus:document.hasFocus(),rect:document.querySelector('iframe')?.getBoundingClientRect().toJSON(),viewport:[innerWidth,innerHeight]})"
      })
    )
  })
  afterAll(async () => {
    try {
      await cleanup?.()
    } finally {
      await server.stop(true)
      if (directory) await rm(directory, { recursive: true, force: true })
    }
  })
  const tool = async <Name extends keyof ToolResults>(
    name: Name,
    args: Record<string, unknown> = {}
  ): Promise<ToolResults[Name]> => (await run(name, { target, ...args })) as ToolResults[Name]

  test("reads a long thread to its end and discovers the cross-origin editor", async () => {
    const first = await tool("browser_read_page")
    assert.ok(first.nextOffset)
    const rest = await tool("browser_read_page", { offset: first.nextOffset })
    assert.ok(rest.text.includes("END OF THREAD"))
    const child = first.frames.find((entry) => entry.parent !== null)
    assert.ok(child, JSON.stringify(first.frames))
    frame = child.id
    await tool("browser_wait", { frame, selector: 'role=textbox[name="Reply"]' })
    const editor = await tool("browser_read_page", { frame })
    assert.ok(editor.accessibility.includes("Reply"))
    assert.equal(editor.fileInputs[0].id, "attachment")
  })
  test("writes a rich-text reply and uploads a real file inside the cross-origin frame", async () => {
    const edit = await tool("browser_type", {
      frame,
      selector: 'role=textbox[name="Reply"]',
      text: "你好，\n问题已处理。",
      replace: true
    })
    assert.equal(edit.matchesRequestedText, true)
    assert.equal(edit.value, "你好，\n问题已处理。")
    assert.ok(
      (await tool("browser_read_page", { frame })).text.includes("问题已处理"),
      JSON.stringify(
        await tool("browser_evaluate", {
          frame,
          expression:
            "({html:document.body.innerHTML,active:document.activeElement?.outerHTML,focus:document.hasFocus()})"
        })
      )
    )
    await tool("browser_upload", { frame, selector: "#attachment", paths: [attachment] })
    const files = await tool("browser_read_elements", { frame, selector: "#attachment" })
    assert.equal(files.elements[0].files?.[0].name, "reply.txt")
    const status = await tool("browser_click", { frame, selector: 'role=button[name="Send reply"]' })
    assert.equal(status.pending, true)
    assert.ok(status.dialog)
    assert.equal(status.dialog.message, "Send this reply?")
    assert.equal(submissions, 0)
    const inspected = await tool("browser_read_page")
    assert.equal(inspected.dialog?.id, status.dialog.id)
    await assert.rejects(tool("browser_dialog", { id: status.dialog.id + 1, accept: true }), /no longer current/)
    await tool("browser_dialog", { id: status.dialog.id, accept: true })
    await tool("browser_wait", { frame, selector: "text=Reply sent" })
    assert.equal(submissions, 1)
    assert.deepEqual(submitted, {
      text: "你好，\n问题已处理。",
      filename: "reply.txt",
      content: "Attachment content 附件"
    })
  })
  test("dismisses a second send without duplicating the business action", async () => {
    const status = await tool("browser_click", { frame, selector: 'role=button[name="Send reply"]' })
    assert.ok(status.dialog)
    await tool("browser_dialog", { id: status.dialog.id, accept: false })
    assert.equal(submissions, 1)
  })
  test("resumes consecutive dialogs without replaying the triggering script", async () => {
    const first = await tool("browser_click", { frame, selector: "#reference" })
    assert.ok(first.dialog)
    const second = await tool("browser_dialog", { id: first.dialog.id, accept: true })
    assert.ok(second.dialog)
    assert.equal(second.dialog.message, "Reference")
    await tool("browser_dialog", { id: second.dialog.id, accept: true, promptText: "CASE-42" })
    assert.equal((await tool("browser_read_elements", { frame, selector: "#reference" })).elements[0].text, "CASE-42")
  })
  test("operates administration controls and collaboration cells without coordinates", async () => {
    await tool("browser_check", { selector: "#approved", checked: true })
    const controls = await tool("browser_read_elements", { selector: "input" })
    assert.equal(controls.elements[0].checked, true)
    assert.equal(controls.elements[1].value, undefined)
    const rest = await tool("browser_read_elements", { selector: "input", limit: 1 })
    assert.equal(rest.nextOffset, 1)
    assert.equal((await tool("browser_read_elements", { selector: "input", offset: 1, limit: 1 })).nextOffset, null)
    await tool("browser_hover", { selector: "#menu" })
    await tool("browser_click", { selector: "#archive" })
    assert.equal((await tool("browser_read_elements", { selector: "#archive" })).elements[0].text, "Archived")
    await tool("browser_double_click", { selector: "#cell" })
    await tool("browser_type", { selector: "#cell", text: "Updated cell", replace: true })
    assert.equal((await tool("browser_read_elements", { selector: "#cell" })).elements[0].text, "Updated cell")
    const appended = await tool("browser_type", { selector: "#cell", text: " 后续\n第二行" })
    assert.equal(appended.value, "Updated cell 后续\n第二行")
    assert.ok((await tool("browser_scroll", { selector: "#rows", y: 800 })).y > 0)
    await tool("browser_drag", { selector: "#drag", destination: "#drop" })
    assert.equal((await tool("browser_read_elements", { selector: "#drop" })).elements[0].text, "Moved")
  })
  test("surfaces a delayed confirmation while waiting for the business result", async () => {
    await tool("browser_evaluate", {
      expression: `setTimeout(() => {
        if (confirm('Confirm delayed save?')) {
          const status = document.createElement('p');
          status.id = 'saved'; status.textContent = 'Saved once';
          document.body.append(status);
        }
      }, 300)`
    })
    const waiting = await tool("browser_wait", { selector: "#saved" })
    assert.equal(waiting.pending, true)
    assert.ok(waiting.dialog)
    await tool("browser_dialog", { id: waiting.dialog.id, accept: true })
    assert.equal((await tool("browser_read_elements", { selector: "#saved" })).total, 1)
  })
  test("rejects detached frames rather than operating the main document", async () => {
    await tool("browser_evaluate", { expression: "document.querySelector('iframe').remove()" })
    await assert.rejects(
      tool("browser_type", { frame, selector: "#cell", text: "Wrong document", replace: true }),
      /Frame (?:is detached or unknown|was detached)/
    )
    assert.equal((await tool("browser_read_elements", { selector: "#cell" })).elements[0].text, "Updated cell 后续\n第二行")
  })
})
