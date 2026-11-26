/** A document the browser shows instead of saving (a PDF) can be saved and is said to be one. */
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, afterEach, beforeAll, describe, test } from "vitest"

import { type BrowserTools, conversations, ipc, reportFailure, requireBrowserFixture } from "./lib/app"

// The smallest document a viewer accepts: one empty page.
const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000052 00000 n 
0000000101 00000 n 
trailer<</Size 4/Root 1 0 R>>
startxref
164
%%EOF
`

describe("documents the browser shows itself", () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      // Shown in the tab, as invoices and reports are: no attachment disposition.
      if (path === "/report.pdf") return new Response(pdf, { headers: { "Content-Type": "application/pdf" } })
      return new Response(
        `<title>Reports</title><a id="report" href="/report.pdf" target="_blank">Quarterly report</a>`,
        {
          headers: { "Content-Type": "text/html" }
        }
      )
    }
  })
  const origin = `http://127.0.0.1:${server.port}`
  const talks = conversations("documents-contract")
  const saved: string[] = []
  let directory: string
  let run: BrowserTools
  let target: string
  let shown: string | undefined

  beforeAll(async () => {
    await ipc("plugin:window|show", { label: "main" })
    await requireBrowserFixture()
    directory = await mkdtemp(join(tmpdir(), "alwith-documents-"))
    run = await talks.agent()
    target = (await run("browser_open", { url: `${origin}/` })).target
  })
  afterEach(reportFailure)
  afterAll(async () => {
    if (shown) await run("browser_close", { target: shown }).catch(() => {})
    await run("browser_close", { target }).catch(() => {})
    await talks.close()
    await server.stop(true)
    // The browser keeps what it saves in the reader's Downloads; what this contract saved there goes.
    for (const path of saved) await rm(path, { force: true })
    await rm(directory, { recursive: true, force: true })
  })
  const save = async (args: Record<string, unknown>, name: string) => {
    const path = join(directory, name)
    const result = await run("browser_download", { ...args, path })
    saved.push(result.sourcePath)
    assert.equal(await Bun.file(path).text(), pdf)
    return result
  }

  test("a link to a PDF saves the PDF, without opening it or leaving the page", async () => {
    const before = (await run("browser_list")).targets.length
    await save({ target, selector: "#report" }, "by-link.pdf")
    assert.equal((await run("browser_evaluate", { target, expression: "location.pathname" })).result, "/")
    assert.equal((await run("browser_list")).targets.length, before)
  })

  test("a tab that shows a PDF says so, and how to read it", async () => {
    shown = (await run("browser_open", { url: `${origin}/report.pdf` })).target
    const snapshot = await run("browser_snapshot", { target: shown })
    assert.equal(snapshot.text, "")
    assert.match(snapshot.instruction, /shows a PDF.*browser_download, without a selector/)
    assert.match((await run("browser_read_page", { target: shown })).note, /shows a PDF/)
  })

  test("the document a tab shows is saved by naming no control", async () => {
    await save({ target: shown }, "by-tab.pdf")
  })
})
