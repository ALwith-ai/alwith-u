import { strict as assert } from "node:assert"

import { test } from "vitest"

import { ipc, requireBrowserFixture, ui, waitFor } from "./lib/app"

test("application calls share control, preserve groups, and drain canceled actions before handoff", async () => {
  await requireBrowserFixture()
  const website = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response('<title>Control contract</title><label>Draft<input id="draft"></label>', {
        headers: { "Content-Type": "text/html" }
      })
  })
  const a = `browser-control-a-${crypto.randomUUID()}`
  const b = `browser-control-b-${crypto.randomUUID()}`
  const call = async (sessionId: string, name: string, args = {}) => {
    const id = `browser-contract-${crypto.randomUUID()}`
    await ui(
      `(() => { const node=document.createElement('output'); node.id=${JSON.stringify(id)}; node.hidden=true; node.dataset.state='pending'; node.textContent=${JSON.stringify(JSON.stringify({ sessionId, name, args }))}; document.body.append(node); node.dispatchEvent(new Event('browser-contract-call',{bubbles:true})); })()`
    )
    try {
      const reply = await waitFor(
        async () => {
          const raw = await ui(
            `(() => {const node=document.getElementById(${JSON.stringify(id)});return node?.dataset.state==='done'?node.textContent:null})()`
          )
          return typeof raw === "string" ? (JSON.parse(raw) as { result?: unknown; error?: string }) : undefined
        },
        `${name} completes`,
        50000
      )
      assert.ok(reply)
      if (reply.error) throw new Error(`${name}: ${reply.error}`)
      return reply.result as {
        target: string
        targets: {
          id: string
          ownerSessionId: string | null
          controllerSessionId: string | null
          available: boolean
        }[]
        result: unknown
      }
    } finally {
      await ui(`document.getElementById(${JSON.stringify(id)})?.remove()`)
    }
  }
  const created: string[] = []
  try {
    const first = await call(a, "browser_open", { url: website.url.href })
    created.push(first.target)
    const second = await call(b, "browser_open", { url: website.url.href })
    created.push(second.target)
    const third = await call(a, "browser_open", { url: website.url.href })
    created.push(third.target)
    const targets = (await call(b, "browser_list")).targets
    assert.equal(targets.find((target) => target.id === first.target)?.ownerSessionId, a)
    assert.equal(targets.find((target) => target.id === first.target)?.available, false)
    const viewport = (
      await call(a, "browser_evaluate", {
        target: first.target,
        expression: "({width:innerWidth,height:innerHeight})"
      })
    ).result as { width: number; height: number }
    assert.ok(viewport.width > 0 && viewport.height > 0, "Background tabs retain their viewport")
    await call(a, "browser_type", {
      target: first.target,
      selector: "#draft",
      text: "Preserved through handoff",
      replace: true
    })
    // Repeated calls from the same conversation reuse the worker's connection.
    assert.equal(
      (
        await call(a, "browser_evaluate", {
          target: first.target,
          expression: "document.querySelector('#draft').value"
        })
      ).result,
      "Preserved through handoff"
    )
    await assert.rejects(
      call(b, "browser_evaluate", {
        target: first.target,
        expression: "document.title"
      }),
      /another|conversation|403|409/
    )
    await waitFor(
      async () =>
        Number(
          await ui(
            '[...document.querySelectorAll("button[aria-label]")].filter(node => node.getAttribute("aria-label").startsWith("标签组 AI")).length'
          )
        ) === 2,
      "Both conversation groups appear"
    )
    const observation = (await call(a, "browser_snapshot", { target: first.target })) as unknown as {
      text: string
      snapshotId: string
    }
    const reference = observation.text.match(/\[ref=([^\]]+)\]/)?.[1]
    assert.ok(reference)
    await call(a, "browser_release", { target: first.target })
    await waitFor(async () => {
      const target = (await call(b, "browser_list")).targets.find(
        (target: { id: string }) => target.id === first.target
      )
      return target?.available && target.controllerSessionId === null
    }, "Released control is idle")
    assert.equal(
      (
        await call(b, "browser_evaluate", {
          target: first.target,
          expression: "document.querySelector('#draft').value"
        })
      ).result,
      "Preserved through handoff"
    )
    assert.equal(
      (await call(b, "browser_list")).targets.find((target) => target.id === first.target)?.ownerSessionId,
      a
    )
    await assert.rejects(
      call(b, "browser_type", {
        target: first.target,
        ref: reference,
        snapshotId: observation.snapshotId,
        text: "must not type"
      }),
      /expired|Unknown.*reference/
    )

    // User takeover must stop an auto-waiting click before a later controller inserts its target.
    await call(b, "browser_release", { target: first.target })
    await call(a, "browser_evaluate", {
      target: first.target,
      expression: "window.lateClicks = 0"
    })
    const waiting = call(a, "browser_click", {
      target: first.target,
      selector: "#late-button"
    }).catch((error) => error)
    await waitFor(async () => {
      try {
        await call(a, "browser_evaluate", {
          target: first.target,
          expression: "document.title"
        })
        return false
      } catch (error) {
        return String(error).includes("busy")
      }
    }, "The old action is waiting")
    await ipc("web_automation_takeover", { target: first.target })
    assert.match(String(await waiting), /closed|cancel|disconnect/i)
    await assert.rejects(
      call(a, "browser_evaluate", {
        target: first.target,
        expression: "document.title"
      }),
      /took over|reclaim/
    )
    await call(b, "browser_evaluate", {
      target: first.target,
      expression:
        "(() => {const button=document.createElement('button');button.id='late-button';button.textContent='Late';button.onclick=()=>window.lateClicks++;document.body.append(button);return true})()"
    })
    assert.equal(
      (
        await call(b, "browser_evaluate", {
          target: first.target,
          expression: "window.lateClicks"
        })
      ).result,
      0
    )
    // Canceling A must leave B's live controller and its draft untouched.
    await ipc("web_automation_cancel", { sessionId: a })
    assert.equal(
      (
        await call(b, "browser_evaluate", {
          target: first.target,
          expression: "document.querySelector('#draft').value"
        })
      ).result,
      "Preserved through handoff"
    )
  } finally {
    await Promise.all([a, b].map((sessionId) => ipc("cef_browser_revoke", { sessionId })))
    for (const label of created) await ipc("cef_close_guest", { label })
    await website.stop(true)
  }
})
