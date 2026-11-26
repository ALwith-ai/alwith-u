/** Generic browser acceptance cases. The same engine is staged into the native application. */
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type Browser, chromium, type Page } from "playwright-core"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest"

import { createBrowserTools } from "../../src/features/web-automation/engine.mjs"

describe("structural and visual browser execution", () => {
  let browser: Browser
  let page: Page
  let run: ReturnType<typeof createBrowserTools>
  let directory: string
  const target = "acceptance-page"
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request): Response {
      const path = new URL(request.url).pathname
      if (path === "/file")
        return new Response("download evidence", {
          headers: {
            "Content-Type": "text/plain",
            "Content-Disposition": 'attachment; filename="evidence.txt"'
          }
        })
      if (path === "/frame")
        return new Response("<button onclick=\"this.textContent='Frame saved'\">Frame save</button>", {
          headers: { "Content-Type": "text/html" }
        })
      return new Response(
        `<!doctype html><title>Acceptance workspace</title>
      <label>Name<input aria-label="Name"></label><input type="password" value="secret-must-not-leak">
      <button id="save" onclick="window.writes++;setTimeout(()=>document.querySelector('[role=status]').textContent='Saved: '+document.querySelector('input').value,80)">Save</button>
      <p role="status">Not saved</p><label><input type="checkbox">Approved</label>
      <div id="shadow"></div><button class="duplicate">Duplicate</button><button class="duplicate">Duplicate</button>
      <a href="/file" download>Download evidence</a>
      <canvas width="160" height="80" style="margin:30px;border:1px solid" onclick="window.canvasClicks++"></canvas>
      <iframe src="http://localhost:${server.port}/frame"></iframe>
      <div contenteditable="true" role="textbox" aria-label="Draft" style="white-space:pre-wrap"></div>
      <script>window.writes=0;window.canvasClicks=0;
      const draft=document.querySelector('[contenteditable]');draft.textContent=localStorage.getItem('draft')||'';
      draft.oninput=()=>localStorage.setItem('draft',draft.innerText);
      document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<button>Shadow action</button>';
      const c=document.querySelector('canvas').getContext('2d');c.fillStyle='blue';c.fillRect(20,20,60,30);
      </script>`,
        { headers: { "Content-Type": "text/html" } }
      )
    }
  })
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
    directory = await mkdtemp(join(tmpdir(), "alwith-observations-"))
  })
  beforeEach(async () => {
    const context = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 })
    page = await context.newPage()
    await page.goto(`http://127.0.0.1:${server.port}`)
    run = createBrowserTools(
      async () => {
        throw Error("Unexpected native call")
      },
      async () =>
        ({
          contexts: () => [context],
          on: () => {},
          close: () => context.close()
        }) as unknown as Browser
    )
  })
  afterEach(async () => {
    await run.close()
  })
  afterAll(async () => {
    await browser.close()
    await server.stop(true)
    await rm(directory, { recursive: true, force: true })
  })
  const call = (name: string, args: Record<string, unknown> = {}) => run(name, { target, ...args })
  const reference = (snapshot: { text: string; snapshotId: string }, label: string) => {
    const line = snapshot.text.split("\n").find((value) => value.includes(label))
    const ref = line?.match(/\[ref=([^\]]+)\]/)?.[1]
    assert.ok(ref, `Missing ${label}: ${snapshot.text}`)
    return { ref, snapshotId: snapshot.snapshotId }
  }

  test.each([1, 2, 3, 4, 5])("mail draft sequence uses observed refs and verifies persistence, run %i", async () => {
    const snapshot = await call("browser_snapshot")
    const draft = reference(snapshot, 'textbox "Draft"')
    await call("browser_type", { ...draft, text: "Hello\n第二行", replace: true })
    await call("browser_verify", { ...draft, condition: "text", expected: "Hello\n第二行" })
    await page.reload()
    const reopened = await call("browser_snapshot")
    await call("browser_verify", {
      ...reference(reopened, 'textbox "Draft"'),
      condition: "text",
      expected: "Hello\n第二行"
    })
    expect(await page.locator("[contenteditable]").innerText()).toBe("Hello\n第二行")
    expect(await page.evaluate(() => (window as any).writes)).toBe(0)
  })
  test.each([1, 2, 3, 4, 5])("administration edit waits for saved result without duplicate write, run %i", async () => {
    const snapshot = await call("browser_snapshot")
    await call("browser_type", { ...reference(snapshot, 'textbox "Name"'), text: "Approved record", replace: true })
    await call("browser_click", reference(snapshot, 'button "Save"'))
    expect(
      await call("browser_verify", { selector: "[role=status]", condition: "text", expected: "Saved: Approved record" })
    ).toMatchObject({ verified: true })
    expect(await page.evaluate(() => (window as any).writes)).toBe(1)
  })
  test.each([1, 2, 3, 4, 5])("cross-origin collaboration control uses upstream frame ref, run %i", async () => {
    const snapshot = await call("browser_snapshot")
    await call("browser_click", reference(snapshot, 'button "Frame save"'))
    const next = await call("browser_snapshot")
    expect(next.text).toContain('button "Frame saved"')
  })
  test("shadow DOM and duplicate names are individually referenced", async () => {
    const snapshot = await call("browser_snapshot")
    await call("browser_click", reference(snapshot, 'button "Shadow action"'))
    const duplicates = snapshot.text.split("\n").filter((line: string) => line.includes('button "Duplicate"'))
    expect(duplicates).toHaveLength(2)
    expect(duplicates[0]).not.toBe(duplicates[1])
    await expect(call("browser_click", { selector: "text=Duplicate" })).rejects.toThrow("strict mode")
  })
  test("superseded snapshots and cross-target references are rejected", async () => {
    const first = await call("browser_snapshot")
    const stale = reference(first, 'button "Save"')
    await call("browser_snapshot")
    await expect(call("browser_click", stale)).rejects.toThrow("expired")
    await expect(call("browser_click", { ...stale, snapshotId: "another-target" })).rejects.toThrow("expired")
    expect(await page.evaluate(() => (window as any).writes)).toBe(0)
  })
  test("DOM replacement cannot silently redirect an issued reference", async () => {
    const snapshot = await call("browser_snapshot")
    await page.locator("#save").evaluate((element) => {
      element.outerHTML = '<button id="save" onclick="window.writes++">Different action</button>'
    })
    await expect(call("browser_click", reference(snapshot, 'button "Save"'))).rejects.toThrow()
    expect(await page.evaluate(() => (window as any).writes)).toBe(0)
    const next = await call("browser_snapshot")
    await call("browser_click", reference(next, 'button "Different action"'))
    expect(await page.evaluate(() => (window as any).writes)).toBe(1)
  })
  test("navigation expires refs even when a new page has matching IDs", async () => {
    const snapshot = await call("browser_snapshot")
    await page.reload()
    await expect(call("browser_click", reference(snapshot, 'button "Save"'))).rejects.toThrow("expired")
  })
  test("bounded and scoped snapshots expose truncation", async () => {
    await page
      .locator("body")
      .evaluate((body) => body.insertAdjacentHTML("beforeend", "<button>Extra</button>".repeat(100)))
    const snapshot = await call("browser_snapshot", { maxChars: 500 })
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.text.length).toBeLessThanOrEqual(500)
    const scoped = await call("browser_snapshot", { selector: "#save", depth: 2 })
    expect(scoped.text).toContain('button "Save"')
    expect(scoped.text).not.toContain('textbox "Name"')
  })
  test("long text is cut where it stands, so the controls after it stay in the snapshot", async () => {
    await page.locator("body").evaluate((body) => {
      // Past the basic plane on purpose: a cut must never leave half a character.
      body.insertAdjacentHTML("afterbegin", `<article>${"𝒜 long thread. ".repeat(2000)}END</article>`)
    })
    const snapshot = await call("browser_snapshot")
    expect(snapshot.truncated).toBe(false)
    expect(snapshot.text).toMatch(/- article \[ref=\w+\]: "(𝒜 long thread\. )+[^"]*…" \[\+\d+ chars\]/)
    expect(snapshot.text).not.toContain("END")
    expect(snapshot.text.isWellFormed()).toBe(true)
    expect(snapshot.text).toContain('button "Save"')
    expect(snapshot.instruction).toContain("browser_read_page")
    // The whole text is one read away.
    const read = await call("browser_read_page", { selector: "article", offset: 29990 })
    expect(read.text.endsWith("END")).toBe(true)
    expect((await call("browser_snapshot", { selector: "#save" })).instruction).not.toContain("browser_read_page")
  })
  test("text typed straight into an editable element is in the snapshot", async () => {
    await page.locator("[contenteditable]").evaluate((draft) => {
      draft.innerHTML = "First line<div>Second line</div>"
    })
    const snapshot = await call("browser_snapshot")
    expect(snapshot.text).toContain('textbox "Draft" [ref=')
    expect(snapshot.text).toMatch(/textbox "Draft" \[ref=\w+\]: "First line\\nSecond line"/)
  })
  test("a frame arriving while the page is read does not fail the snapshot", async () => {
    await page.evaluate((source) => {
      for (let index = 0; index < 5; index++)
        setTimeout(() => {
          const frame = document.createElement("iframe")
          frame.src = `${source}?late=${index}`
          document.body.append(frame)
        }, index * 15)
    }, `http://localhost:${server.port}/frame`)
    const snapshot = await call("browser_snapshot")
    expect(snapshot.text).toContain('button "Save"')
    // Every frame the reading shows can be addressed: none is missing from the list.
    expect(snapshot.text.match(/- iframe/g)!.length).toBeLessThanOrEqual(snapshot.frames.length - 1)
    // A reference from before the last frame arrived is refused or used, never a crash.
    await call("browser_click", reference(snapshot, 'button "Save"')).catch((error: Error) =>
      expect(error.message).toMatch(/expired element reference|Stale element/)
    )
  })
  test("password values are absent from structural snapshots and page reads", async () => {
    expect(JSON.stringify(await call("browser_snapshot"))).not.toContain("secret-must-not-leak")
    expect(JSON.stringify(await call("browser_read_page"))).not.toContain("secret-must-not-leak")
  })
  test("a changed accessible name invalidates the original action reference", async () => {
    const snapshot = await call("browser_snapshot")
    await page.locator("#save").evaluate((button) => {
      button.textContent = "Delete record"
    })
    await expect(call("browser_click", reference(snapshot, 'button "Save"'))).rejects.toThrow("Stale")
    expect(await page.evaluate(() => (window as any).writes)).toBe(0)
  })
  test("semantic resolution produces a reusable upstream locator", async () => {
    const snapshot = await call("browser_snapshot")
    const result = await call("browser_resolve", reference(snapshot, 'textbox "Name"'))
    expect(result.locator).toMatch(/Name/)
  })
  test("verification checks values, checkbox state, count, visibility and URL", async () => {
    await call("browser_type", { selector: "input[aria-label=Name]", text: "A", replace: true })
    await call("browser_check", { selector: "input[type=checkbox]", checked: true })
    for (const args of [
      { selector: "input[aria-label=Name]", condition: "value", expected: "A" },
      { selector: "input[type=checkbox]", condition: "checked", expected: true },
      { selector: ".duplicate", condition: "count", expected: 2 },
      { selector: "#save", condition: "visible" },
      { selector: "#missing", condition: "hidden" },
      { condition: "url", expected: page.url() }
    ])
      expect((await call("browser_verify", args)).verified).toBe(true)
  })
  test("failed verification does not replay a write", async () => {
    await call("browser_click", { selector: "#save" })
    await expect(
      call("browser_verify", { selector: "[role=status]", condition: "text", expected: "Impossible", timeoutMs: 100 })
    ).rejects.toThrow()
    expect(await page.evaluate(() => (window as any).writes)).toBe(1)
  })
  test("actual cropped PNG and image-relative click work at device scale two", async () => {
    const capture = await call("browser_screenshot", { selector: "canvas" })
    const png = Buffer.from(capture.image.data, "base64")
    expect(png.subarray(1, 4).toString()).toBe("PNG")
    expect(png.readUInt32BE(16)).toBe(Math.ceil(capture.region.width))
    await call("browser_visual", { imageId: capture.imageId, action: "click", x: 40, y: 30 })
    expect(await page.evaluate(() => (window as any).canvasClicks)).toBe(1)
    await expect(call("browser_visual", { imageId: capture.imageId, action: "click", x: 40, y: 30 })).rejects.toThrow(
      "expired"
    )
  })
  test("scroll or DOM changes invalidate visual coordinates", async () => {
    const capture = await call("browser_screenshot")
    await page.locator("#save").evaluate((button) => {
      button.textContent = "Changed"
    })
    await expect(call("browser_visual", { imageId: capture.imageId, action: "click", x: 2, y: 2 })).rejects.toThrow(
      "changed"
    )
  })
  test("canvas pixel changes invalidate coordinates even when the accessibility tree is unchanged", async () => {
    const capture = await call("browser_screenshot", { selector: "canvas" })
    await page.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d")!
      context.fillStyle = "red"
      context.fillRect(20, 20, 60, 30)
    })
    await expect(call("browser_visual", { imageId: capture.imageId, action: "click", x: 40, y: 30 })).rejects.toThrow(
      "pixels changed"
    )
    expect(await page.evaluate(() => (window as any).canvasClicks)).toBe(0)
  })
  test("a cropped visual action survives unrelated pixels changing outside its captured region", async () => {
    const capture = await call("browser_screenshot", { selector: "canvas" })
    await page.locator("#save").evaluate((button: HTMLElement) => {
      button.style.background = "red"
    })
    await call("browser_visual", { imageId: capture.imageId, action: "click", x: 40, y: 30 })
    expect(await page.evaluate(() => (window as any).canvasClicks)).toBe(1)
  })
  test("out of image coordinates cannot click", async () => {
    const capture = await call("browser_screenshot", { selector: "canvas" })
    await expect(call("browser_visual", { imageId: capture.imageId, action: "click", x: -1, y: 20 })).rejects.toThrow(
      "outside"
    )
    expect(await page.evaluate(() => (window as any).canvasClicks)).toBe(0)
  })
  test("download returns saved bytes without overwriting existing files", async () => {
    const path = join(directory, "download.txt")
    const snapshot = await call("browser_snapshot")
    const input = { ...reference(snapshot, 'link "Download evidence"'), path }
    expect(await call("browser_download", input)).toMatchObject({ ok: true, bytes: 17 })
    expect(await readFile(path, "utf8")).toBe("download evidence")
    let clicks = 0
    await page.exposeFunction("recordDownloadClick", () => {
      clicks++
    })
    await page
      .locator("a[download]")
      .evaluate((link) => link.addEventListener("click", () => (window as any).recordDownloadClick()))
    await expect(call("browser_download", input)).rejects.toThrow("EEXIST")
    expect(clicks).toBe(0)
    expect(await readFile(path, "utf8")).toBe("download evidence")
  })
  test("concurrent operations on one target fail explicitly", async () => {
    const pending = call("browser_verify", { selector: "[role=status]", condition: "text", expected: "Not saved" })
    await expect(call("browser_snapshot")).rejects.toThrow("busy")
    await pending
  })
})
