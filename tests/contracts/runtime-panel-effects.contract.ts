/** Native effect observers must survive panel conversion in either runtime. */
import assert from "node:assert/strict"

import { beforeAll, describe, test } from "vitest"

import { ipc, rpc, ui, waitFor } from "./lib/app"

describe.runIf(process.platform === "darwin")("runtime panel effects", () => {
  const chat = (command: string, args: unknown = {}) => rpc("ipc", { window: "chat", command, args })
  const chatUi = (script: string) => rpc("eval", { window: "chat", script })
  const visible = () => chat("plugin:window|is_visible", { label: "chat" })
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
      // Exercise disposal with glass still attached after the panel has resigned key status.
      await chat("plugin:window|hide", { label: "chat" })
      await waitFor(async () => !(await visible()), `Cycle ${cycle}: the chat panel did not hide`)
      await ipc("plugin:window|close", { label: "chat" })
      await absent()
      assert.equal(await ui("document.readyState"), "complete", `Cycle ${cycle}: host stopped responding`)
    }
  })

  test("closing a retained chat panel hides it and reopens the same webview", async () => {
    await ipc("show_main_window")
    await ipc("plugin:webview|create_webview_window", {
      options: {
        label: "chat",
        url: "native-shell-test.html",
        title: "Retained chat panel",
        width: 560,
        height: 640,
        minWidth: 420,
        minHeight: 360,
        center: true,
        decorations: false,
        transparent: true,
        alwaysOnTop: true,
        visible: false,
        focus: false,
        maximizable: false,
        skipTaskbar: true
      }
    })
    await waitFor(
      () => chatUi("document.readyState === 'complete'").catch(() => false),
      "Chat fixture did not load",
      30_000
    )
    // Hasgard evaluates in an isolated world under CEF. The listener belongs to the application world.
    await chatUi(`(() => {
      const script = document.createElement("script")
      script.textContent = ${JSON.stringify(`
        (async () => {
          const api = window.__TAURI_INTERNALS__
          const draft = document.createElement("textarea")
          draft.id = "retained-draft"
          draft.value = "Unsent draft"
          document.body.append(draft)
          let closeCount = 0
          const listener = await api.invoke("plugin:event|listen", {
            event: "tauri://close-requested",
            target: { kind: "WebviewWindow", label: "chat" },
            handler: api.transformCallback(async () => {
              await api.invoke("plugin:window|hide", { label: "chat" })
              document.body.dataset.closeCount = String(++closeCount)
            })
          })
          document.body.addEventListener("unlisten-close", async () => {
            await api.invoke("plugin:event|unlisten", { event: "tauri://close-requested", eventId: listener })
            document.body.dataset.closeCount = "unregistered"
          }, { once: true })
          document.body.dataset.closeCount = "0"
        })()
      `)}
      document.documentElement.append(script)
      script.remove()
    })()`)
    await waitFor(() => chatUi('document.body.dataset.closeCount === "0"'), "Close listener did not register")
    await chat("set_chat_window_backdrop", { cornerRadius: 24 })
    await chat("present_chat_window")
    await waitFor(visible, "Chat panel did not show")

    for (const cycle of [1, 2, 3]) {
      await chat("plugin:window|close", { label: "chat" })
      await waitFor(
        () => chatUi(`document.body.dataset.closeCount === "${cycle}"`),
        `Cycle ${cycle}: the retained webview did not handle the native close request`
      )
      assert.equal(await visible(), false, `Cycle ${cycle}: the chat panel was still visible`)
      await chat("present_chat_window")
      await waitFor(visible, `Cycle ${cycle}: the chat panel did not reopen`)
      assert.equal(await chatUi('document.querySelector("#retained-draft").value'), "Unsent draft")
      assert.equal(await ui("document.readyState"), "complete", `Cycle ${cycle}: the host stopped responding`)
    }

    await chat("plugin:window|hide", { label: "chat" })
    await waitFor(async () => !(await visible()), "Chat panel did not hide for cleanup")
    await chatUi('document.body.dispatchEvent(new Event("unlisten-close"))')
    await waitFor(
      () => chatUi('document.body.dataset.closeCount === "unregistered"'),
      "Close listener did not unregister"
    )
    await ipc("plugin:window|close", { label: "chat" })
    await absent()
  })
})
