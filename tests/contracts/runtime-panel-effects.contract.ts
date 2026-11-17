/** Native effect observers must survive panel conversion in either runtime. */
import assert from "node:assert/strict"

import { beforeAll, describe, test } from "vitest"

import { ipc, rpc, ui, waitFor } from "./lib/app"

describe.runIf(process.platform === "darwin")("runtime panel effects", () => {
  const chat = (command: string, args: unknown = {}) => rpc("ipc", { window: "chat", command, args })
  const absent = () =>
    waitFor(async () => {
      const result = (await rpc("windows.list", {})) as { windows: { label: string }[] }
      return !result.windows.some((window) => window.label === "chat")
    }, "Chat window did not close")

  beforeAll(async () => {
    assert.match(
      String(await ui("location.pathname")),
      /native-shell-test\.html$/,
      "Use the isolated native shell fixture"
    )
    assert.match(String(await ui("navigator.platform")), /Mac/, "This contract exercises AppKit observers")
    const capabilities = (await ipc("runtime_capabilities")) as { backend: string }
    console.info(`Panel effects backend: ${capabilities.backend}`)
  })

  test("glass installed before presentation survives conversion, effect updates and closing", async () => {
    for (let cycle = 0; cycle < 5; cycle++) {
      await ipc("plugin:webview|create_webview_window", {
        options: {
          label: "chat",
          url: "native-shell-test.html",
          title: "Panel effects contract",
          width: 480,
          height: 360,
          visible: false,
          transparent: true,
          decorations: false
        }
      })
      await waitFor(
        () =>
          rpc("eval", {
            window: "chat",
            script: "document.readyState === 'complete'"
          }).catch(() => false),
        "Chat fixture did not load"
      )
      const draft = `Panel draft ${cycle}`
      await rpc("eval", {
        window: "chat",
        script: `(() => { const input = document.createElement('textarea'); input.id = 'panel-draft'; input.value = ${JSON.stringify(draft)}; document.body.append(input) })()`
      })
      // The backdrop hook can run before the first present. Conversion must preserve its KVO.
      await chat("set_chat_window_backdrop", { cornerRadius: 24 })
      await chat("present_chat_window")
      for (const cornerRadius of [30, null, 24, null, 24]) {
        await chat("set_chat_window_backdrop", { cornerRadius })
      }
      assert.equal(
        await rpc("eval", { window: "chat", script: "document.getElementById('panel-draft').value" }),
        draft,
        "Panel conversion and effect changes must preserve the live webview"
      )
      // Leave glass attached when closing: the reverse class change must preserve observers too.
      await ipc("plugin:window|close", { label: "chat" })
      await absent()
      assert.equal(await ui("document.readyState"), "complete", `Cycle ${cycle}: host stopped responding`)
    }
  })
})
