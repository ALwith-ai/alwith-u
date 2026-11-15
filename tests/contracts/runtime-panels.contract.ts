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
      () => rpc("eval", { window, script: "document.readyState === 'complete'" }).catch(() => false),
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
})
