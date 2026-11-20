/** Run on an isolated native test application built with ALWITH_NATIVE_TEST=1. */
import assert from "node:assert/strict"

import { test } from "vitest"

import { ipc, rpc, ui, waitFor } from "./lib/app"

const main = "main"
const pet = "vibemon"
const bubble = "bubble-menu-vibemon"
const windowCall = (window: string, command: string, args: object = {}) => rpc("ipc", { window, command, args })
const evaluate = (window: string, script: string) => rpc("eval", { window, script })
const visible = () => windowCall(bubble, "plugin:window|is_visible", { label: bubble })

test("a backgrounded main window presents and resolves each permission in the Vibémon bubble", async () => {
  const url = new URL(String(await ui("location.href")))
  assert.match(url.pathname, /\/(native-shell-test|browser-fixture|vibemon-permission-fixture)\.html$/)
  url.pathname = "/vibemon-permission-fixture.html"
  await ipc("show_main_window")
  try {
    for (const [label, create] of [
      [main, null],
      [pet, "create-vibemon"],
      [bubble, "create-bubble"]
    ] as const) {
      if (create !== null) await ipc("vibemon_window", { action: create, payload: null })
      await waitFor(
        () => evaluate(label, "document.readyState === 'complete'").catch(() => false),
        `${label} did not load`
      )
      await rpc("navigate", { window: label, url: url.href })
      await waitFor(
        () => evaluate(label, "document.querySelector('#root')?.dataset.ready === 'true'").catch(() => false),
        `${label} fixture did not start`,
        15000
      )
    }

    const start = () =>
      ipc("plugin:event|emit_to", {
        target: { kind: "AnyLabel", label: main },
        event: "vibemon-test:begin",
        payload: null
      })
    const surface = (label: "main" | "chat", visible: boolean) =>
      ipc("plugin:event|emit_to", {
        target: { kind: "AnyLabel", label: main },
        event: "vibemon-test:surface",
        payload: { label, visible }
      })
    const decision = async (kind: "allow" | "reject", optionId: string) => {
      const selector = `button[data-decision="${kind}"]`
      await waitFor(() => evaluate(bubble, `!!document.querySelector('${selector}')`), `${kind} button did not render`)
      const colors: unknown = await evaluate(
        bubble,
        `(() => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d')
        context.fillStyle = getComputedStyle(document.querySelector('${selector}')).backgroundColor
        context.fillRect(0, 0, 1, 1)
        const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
        return alpha === 255 && (${kind === "allow"} ? green > red && green > blue : red > green && red > blue)
      })()`
      )
      assert.equal(colors, true, `${kind} button has the wrong decision color`)
      await evaluate(bubble, `document.querySelector('${selector}').click()`)
      await waitFor(async () => {
        return ui(
          `JSON.parse(document.querySelector('#root').dataset.result ?? 'null')?.outcome?.optionId === '${optionId}'`
        )
      }, `${kind} did not reach the original request`)
      await waitFor(async () => !(await visible()), "The answered permission did not close")
    }

    await ipc("plugin:window|center", { label: main })
    await ipc("show_main_window")
    await waitFor(async () => !(await ipc("main_window_hidden")), "The native main window is not visible")
    await start()
    await waitFor(
      () => ui("document.querySelector('#root').dataset.pending === 'true'"),
      "The fake agent did not request permission"
    )
    assert.equal(await visible(), false)
    await ipc("plugin:window|minimize", { label: main })
    await waitFor(
      () => ipc("plugin:window|is_minimized", { label: main }),
      "The native minimized event did not reach the main window"
    )
    await waitFor(visible, "An existing request did not open its native bubble after minimization")
    await decision("allow", "allow_once")

    await start()
    await waitFor(visible, "A new request did not open its native bubble while minimized")
    await decision("reject", "decline")

    await start()
    await waitFor(visible, "The next request did not open its native bubble")
    await ipc("show_main_window")
    await waitFor(async () => !(await visible()), "The permission bubble remained visible after restoring main")
    assert.equal(await ui("document.querySelector('#root').dataset.pending"), "true")

    await ipc("plugin:window|close", { label: main })
    await waitFor(() => ipc("main_window_hidden"), "The native hidden state did not update")
    assert.equal(await ipc("plugin:window|is_minimized", { label: main }), false)
    await waitFor(visible, "A hidden but unminimized main window did not open its native bubble")
    await decision("allow", "allow_once")

    await ipc("show_main_window")
    await waitFor(async () => !(await ipc("main_window_hidden")), "The native main window did not restore")
    await surface("main", false)
    await surface("chat", true)
    await start()
    await waitFor(() => ui("document.querySelector('#root').dataset.pending === 'true'"), "No floating chat request")
    assert.equal(await visible(), false, "The visible floating chat already presents the permission")
    await surface("chat", false)
    await waitFor(visible, "Collapsing the floating chat did not hand its permission to the pet")
    assert.equal(await ipc("main_window_hidden"), false)
    await decision("reject", "decline")
  } finally {
    await ipc("plugin:window|close", { label: bubble }).catch(() => {})
    await ipc("plugin:window|close", { label: pet }).catch(() => {})
    await ipc("show_main_window")
  }
})
