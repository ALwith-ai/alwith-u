/** Panel windows contract, the same on both backends; run against an isolated shell-test instance. */
import assert from "node:assert/strict"

import { beforeAll, describe, test } from "vitest"

import { ipc, rpc, ui, waitFor } from "./lib/app"

describe("runtime panels", () => {
  let capabilities: { backend: string; embeddedBrowser: boolean }
  // A window just made has no address for a moment, and listing fails until it has: asked again.
  const windows = async (): Promise<{ label: string; url: string }[] | undefined> =>
    rpc("windows.list", {}).then(
      (list) => list.windows,
      () => undefined
    )
  const ready = (window: string) =>
    waitFor(
      () =>
        rpc("eval", {
          window,
          script: `document.readyState === "complete" && location.pathname === ${JSON.stringify(
            window === "vibemon" ? "/vibemon.html" : "/vibemon-bubble.html"
          )}`
        }).catch(() => false),
      `${window} did not finish loading`,
      15000
    )

  beforeAll(async () => {
    await waitFor(
      () => ui("document.readyState === 'complete'").catch(() => false),
      "The main window is not ready",
      15000
    )
    capabilities = await ipc("runtime_capabilities")
  })

  test("the backend says which it is", () => {
    assert.ok(["wry", "cef"].includes(capabilities.backend), `Unknown runtime backend: ${capabilities.backend}`)
  })

  test("Wry neither advertises nor serves the embedded browser", async ({ skip }) => {
    if (capabilities.backend !== "wry") skip("The embedded browser is CEF's; nothing to refuse here")
    assert.equal(capabilities.embeddedBrowser, false, "Wry must not advertise embedded browser support")
    await assert.rejects(ipc("cef_browser_context"), /./, "Wry must not register CEF browser commands")
  })

  test("the pet and its bubble open as the application's own pages and close, five times over", async () => {
    for (let cycle = 0; cycle < 5; cycle++) {
      for (const [action, label] of [
        ["create-vibemon", "vibemon"],
        ["create-bubble", "bubble-menu-vibemon"]
      ] as const) {
        assert.equal(await ipc("vibemon_window", { action, payload: null }), true, `Cycle ${cycle}: no new ${label}`)
        await waitFor(
          async () =>
            (await windows())?.some(
              (w) => w.label === label && /^(?:https?:\/\/tauri\.localhost|tauri:\/\/localhost)\//.test(w.url)
            ),
          `Cycle ${cycle}: ${label} is not listed at the application's own address`,
          15000
        )
        await ready(label)
      }
      for (const label of ["bubble-menu-vibemon", "vibemon"]) {
        await ipc("plugin:window|close", { label })
        await waitFor(
          async () => (await windows())?.every((w) => w.label !== label),
          `Cycle ${cycle}: close timed out: ${label}`
        )
      }
    }
  })

  test("the visible bubble stays in the work area as the pet moves to all four corners", async () => {
    const pet = "vibemon"
    const bubble = "bubble-menu-vibemon"
    const action = <T>(window: string, action: string, payload: unknown = null): Promise<T> =>
      rpc("ipc", { window, command: "vibemon_window", args: { action, payload } })
    type Point = { x: number; y: number }
    type Size = { width: number; height: number }
    const { workArea } = (await ipc("plugin:window|current_monitor", { label: "main" })) as {
      workArea: { position: Point; size: Size }
    }
    const { x: left, y: top } = workArea.position
    const right = left + workArea.size.width
    const bottom = top + workArea.size.height
    const corners = [true, false].flatMap((upper) => [true, false].map((leading) => ({ upper, leading })))
    try {
      await action("main", "create-vibemon")
      await action("main", "create-bubble")
      await ready(pet)
      await ready(bubble)
      await action(pet, "present")
      await action(bubble, "bubble-size", { width: 340, height: 220 })
      await action(pet, "bubble", { visible: true })
      await action(bubble, "bubble-blur", {
        enabled: true,
        radius: 0,
        path: [
          { kind: "move", x: 0, y: 0 },
          { kind: "line", x: 340, y: 0 },
          { kind: "line", x: 340, y: 220 },
          { kind: "line", x: 0, y: 220 },
          { kind: "close" }
        ]
      })
      assert.equal(
        await rpc("ipc", { window: bubble, command: "plugin:window|is_visible", args: { label: bubble } }),
        true
      )
      const petSize = await action<Size>(pet, "size")
      const bubbleSize = await action<Size>(bubble, "size")
      for (const { upper, leading } of corners) {
        await action(pet, "move", {
          x: leading ? left : right - petSize.width,
          y: upper ? top : bottom - petSize.height
        })
        await waitFor(async () => {
          const parent = await action<Point>(pet, "position")
          const child = await action<Point>(bubble, "position")
          const expectedX = leading ? left : right - bubbleSize.width
          const expectedY = upper ? parent.y + petSize.height : parent.y - bubbleSize.height
          return Math.abs(child.x - expectedX) <= 2 && Math.abs(child.y - expectedY) <= 2
        }, `Bubble did not follow ${capabilities.backend} pet to ${upper ? "top" : "bottom"} ${leading ? "left" : "right"}`)
      }
    } finally {
      await action("main", "destroy-vibemon")
    }
  })
})
