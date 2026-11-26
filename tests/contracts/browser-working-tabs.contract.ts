/** A page a conversation works on stays drawn and sized, whatever the reader is looking at. */
import assert from "node:assert/strict"

import { afterAll, afterEach, beforeAll, describe, test } from "vitest"

import { type BrowserTools, conversations, ipc, reportFailure, requireBrowserFixture, ui, waitFor } from "./lib/app"

describe("tabs a conversation works on", () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new Response(
        `<title>Work ${new URL(request.url).pathname.slice(1)}</title><label>Draft<input id="draft"></label><button id="save" onclick="document.querySelector('#result').textContent='Saved'">Save</button><p id="result"></p>`,
        { headers: { "Content-Type": "text/html" } }
      )
  })
  const origin = `http://127.0.0.1:${server.port}`
  const talks = conversations("working-tabs-contract")
  const targets: string[] = []
  let a: BrowserTools
  let b: BrowserTools
  let behind: string
  let shown: string
  /** Frames a page is given in half a second, and how wide it is. */
  const drawn = async (tools: BrowserTools, target: string) =>
    (
      await tools("browser_evaluate", {
        target,
        expression: `new Promise(done=>{const start=performance.now();let frames=0;const tick=()=>{frames++;if(performance.now()-start<500)requestAnimationFrame(tick)};requestAnimationFrame(tick);setTimeout(()=>done({frames,width:innerWidth,height:innerHeight}),520)})`
      })
    ).result as { frames: number; width: number; height: number }
  /** The fewest frames of several half seconds in a row: a surface stops being drawn a moment after it is hidden. */
  const steadily = async (tools: BrowserTools, target: string) => {
    let fewest = Infinity
    for (let sample = 0; sample < 6; sample++) fewest = Math.min(fewest, (await drawn(tools, target)).frames)
    return fewest
  }
  const panels = () =>
    ui(
      `JSON.stringify([...document.querySelectorAll('[role=tabpanel]')].map(panel=>({title:panel.getAttribute('aria-label'),hidden:panel.getAttribute('aria-hidden')==='true',invisible:getComputedStyle(panel).visibility==='hidden'})))`
    ).then((value) => JSON.parse(value as string) as { title: string; hidden: boolean; invisible: boolean }[])
  const panel = async (title: string) => (await panels()).find((entry) => entry.title === title)

  beforeAll(async () => {
    await ipc("plugin:window|show", { label: "main" })
    await requireBrowserFixture()
  })
  afterEach(reportFailure)
  afterAll(async () => {
    await talks.close()
    for (const label of targets) await ipc("cef_close_guest", { label }).catch(() => {})
    await server.stop(true)
  })

  test("two conversations work in a tab each, one behind the other", async () => {
    ;[a, b] = await Promise.all([talks.agent(), talks.agent()])
    behind = (await a("browser_open", { url: `${origin}/A` })).target
    shown = (await b("browser_open", { url: `${origin}/B` })).target
    targets.push(behind, shown)
    // A caret blinking in a field repaints the page for as long as it is there, as real pages do.
    for (const [tools, target] of [
      [a, behind],
      [b, shown]
    ] as const)
      await tools("browser_evaluate", { target, expression: "document.querySelector('#draft').focus()" })
    // The titles arrive from the pages a moment after the tabs do.
    await waitFor(async () => (await panel("Work A"))?.hidden === true, "Tab A is not behind")
    await waitFor(async () => (await panel("Work B"))?.hidden === false, "Tab B is not shown")
  })

  test("the tab behind is out of sight, yet drawn as often as the one shown", async () => {
    await waitFor(async () => (await panel("Work A"))?.invisible === false, "A working tab is hidden")
    // The tab the browser started with is behind as well, and nobody works on it.
    assert.ok(
      (await panels()).some((entry) => entry.hidden && entry.invisible),
      JSON.stringify(await panels())
    )
    const [back, front] = [await steadily(a, behind), await steadily(b, shown)]
    assert.ok(front >= 15, `The shown tab is drawn ${front} times in half a second`)
    assert.ok(back >= 15, `The tab behind is drawn ${back} times in half a second`)
    await a("browser_click", { target: behind, selector: "#save" })
    await a("browser_verify", { target: behind, selector: "#result", condition: "text", expected: "Saved" })
  })

  test("closing the browser leaves a working tab its size and its frames", async () => {
    const before = await drawn(a, behind)
    assert.ok(before.width > 0 && before.height > 0, JSON.stringify(before))
    await ui(`document.querySelector('button[aria-label="收起网页"]').click()`)
    await waitFor(
      () => ui(`document.querySelector('[data-browser-pane]').getBoundingClientRect().width === 0`),
      "The pane did not close"
    )
    const closed = await drawn(a, behind)
    assert.deepEqual([closed.width, closed.height], [before.width, before.height])
    assert.ok((await steadily(a, behind)) >= 15, "A working tab in a closed browser is no longer drawn")
    await a("browser_type", { target: behind, selector: "#draft", text: "typed while closed", replace: true })
    await a("browser_verify", {
      target: behind,
      selector: "#draft",
      condition: "value",
      expected: "typed while closed"
    })
  })

  test("a tab nobody works on any more is hidden again", async () => {
    await a("browser_focus", { target: behind })
    await waitFor(
      () => ui(`document.querySelector('[data-browser-pane]').getBoundingClientRect().width > 0`),
      "The pane did not open"
    )
    await b("browser_release", { target: shown })
    await waitFor(async () => {
      const released = await panel("Work B")
      return released?.hidden === true && released.invisible
    }, "A released tab behind is still drawn")
  })

  test("a website is told languages as Chrome states them, without a script", async () => {
    const { result } = await a("browser_evaluate", { target: behind, expression: "navigator.languages" })
    for (const language of result as string[])
      assert.match(language, /^[a-z]{2,3}(-([A-Z]{2}|\d{3}))?$/, `${language} in ${JSON.stringify(result)}`)
  })
})
