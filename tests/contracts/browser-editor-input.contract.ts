import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { type Browser, chromium } from "playwright-core"
import { test } from "vitest"

import { createBrowserTools } from "../../src/features/web-automation/engine.mjs"

type Editor = {
  name: string
  /** Markup after the fields that creates the editor in #editor with "Original draft". */
  page: string
  assets: Record<string, () => Promise<Response>>
  /** The element that takes keyboard focus, and the one that shows the document. */
  editor: string
  content: string
}

const codeMirror5 = dirname(fileURLToPath(import.meta.resolve("codemirror/package.json")))
const editors: Editor[] = [
  {
    // Keyboard input goes to a hidden textarea proxy, as on many older sites and admin systems.
    name: "CodeMirror 5",
    page: `<link rel="stylesheet" href="/editor.css"><script src="/editor.js"></script><script>CodeMirror(document.querySelector('#editor'),{value:'Original draft',lineWrapping:true});</script>`,
    assets: {
      "/editor.js": async () => new Response(Bun.file(join(codeMirror5, "lib/codemirror.js"))),
      "/editor.css": async () => new Response(Bun.file(join(codeMirror5, "lib/codemirror.css")))
    },
    editor: "#editor .CodeMirror",
    content: "#editor .CodeMirror-code"
  },
  {
    // Keyboard input goes to a contenteditable element whose DOM the editor owns.
    name: "CodeMirror 6",
    page: `<script type="module" src="/editor.js"></script>`,
    assets: {
      "/editor.js": async () => {
        const build = await Bun.build({
          entrypoints: [fileURLToPath(new URL("./fixtures/codemirror6/editor.ts", import.meta.url))],
          target: "browser"
        })
        if (!build.success) throw new AggregateError(build.logs, "CodeMirror 6 fixture did not build")
        return new Response(build.outputs[0], { headers: { "Content-Type": "text/javascript" } })
      }
    },
    editor: "#editor .cm-content",
    content: "#editor .cm-content"
  }
]

test.each(editors)(
  "native keyboard input edits $name without clicking it or changing another field",
  async (fixture) => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const asset = fixture.assets[new URL(request.url).pathname]
        if (asset) return asset()
        return new Response(
          `<!doctype html><input id="ordinary" value="Keep me"><div id="editor"></div><button id="outside">Outside</button>${fixture.page}`,
          { headers: { "Content-Type": "text/html" } }
        )
      }
    })
    let close: () => Promise<void> = async () => {}
    let browser: Browser | undefined
    let target = "editor"
    try {
      let run: ReturnType<typeof createBrowserTools>
      if (process.env.BROWSER_WORKFLOWS_CEF === "1") {
        const { conversations, ipc, requireBrowserFixture } = await import("./lib/app")
        await requireBrowserFixture()
        const sessions = conversations(`editor-input-${fixture.name.replace(/\W+/g, "-").toLowerCase()}`)
        run = await sessions.agent()
        target = (await run("browser_open", { url: server.url.href })).target
        close = async () => {
          await sessions.close()
          await ipc("cef_close_guest", { label: target })
        }
      } else {
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
        close = () => run.close()
      }
      const call = (name: string, args: Record<string, unknown>) => run(name, { target, ...args })
      await call("browser_wait", { selector: fixture.editor })
      if (fixture.name === "CodeMirror 5") {
        const proxy = await call("browser_evaluate", {
          expression: "document.querySelector('#editor textarea').parentElement.getBoundingClientRect().height"
        })
        assert.equal(proxy.result, 0)
      }
      await call("browser_type", {
        selector: fixture.editor,
        text: "验收任务 📝",
        replace: true,
        mode: "keyboard"
      })
      await call("browser_verify", { selector: fixture.content, condition: "text", expected: "验收任务 📝" })
      await call("browser_type", { selector: fixture.editor, text: " 已核对", mode: "keyboard" })
      await call("browser_verify", {
        selector: fixture.content,
        condition: "text",
        expected: "验收任务 📝 已核对"
      })
      await assert.rejects(
        call("browser_type", { selector: "#outside", text: "Do not type", mode: "keyboard" }),
        /editable focus/
      )
      await call("browser_verify", { selector: "#ordinary", condition: "value", expected: "Keep me" })
      await call("browser_type", { selector: "#ordinary", text: "普通输入", replace: true })
      await call("browser_verify", { selector: "#ordinary", condition: "value", expected: "普通输入" })
    } finally {
      await close()
      await browser?.close()
      await server.stop(true)
    }
  }
)
