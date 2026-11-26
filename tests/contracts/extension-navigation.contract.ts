import assert from "node:assert/strict"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { test } from "vitest"

import { ipc, requireBrowserFixture, ui, waitFor } from "./lib/app"

test("only the extension host document's navigation releases its instances", async () => {
  await requireBrowserFixture()

  const id = `extension-navigation-${crypto.randomUUID()}`
  const directory = fileURLToPath(new URL(`../../src-tauri/resources/extensions/${id}`, import.meta.url))
  const request = (request: Record<string, unknown>) => ipc("plugin:alwith-extension|dispatch", { request })
  let loads = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/") return new Response(null, { status: 404 })
      const title = `Extension navigation ${++loads}`
      // Keep the first load in flight until the native child WebView is registered.
      await Bun.sleep(300)
      return new Response(`<title>${title}</title>`, {
        headers: { "Content-Type": "text/html", "Cache-Control": "no-store" }
      })
    }
  })
  let guest: string | undefined
  let token: string | undefined
  let installed = false
  try {
    await mkdir(directory)
    await writeFile(
      resolve(directory, "manifest.json"),
      JSON.stringify({
        manifestVersion: 3,
        id,
        name: id,
        version: "1.0.0",
        entry: "main.js",
        dependencies: { "@alwith/module-extension": "^0.6.0" },
        dataSchemaVersion: 1
      })
    )
    await writeFile(resolve(directory, "main.js"), "module.exports = () => ({})\n")
    const bundles: { id: string; path: string; source: string }[] = await ipc("extension_bundles")
    const bundle = bundles.find((bundle) => bundle.id === id)
    assert.ok(bundle, "The test application must use the checkout's staged extensions directory")
    await request({
      type: "installLocal",
      path: bundle.path,
      source: bundle.source,
      expectedId: id,
      expectedVersion: "1.0.0"
    })
    installed = true
    await request({ type: "enable", id })
    token = (await request({ type: "register", id })).activation.token

    const read = () => request({ type: "readData", token })
    const sequence = async () => (await request({ type: "snapshot" })).snapshot.sequence
    const initialSequence = await sequence()
    const mainDocument = await ui("performance.timeOrigin")
    assert.deepEqual(await read(), { type: "data", data: null })

    const openGuest = await ipc("cef_open_guest", { url: server.url.href })
    guest = openGuest.label
    const waitForGuest = (load: number) =>
      waitFor(async () => {
        const metadata = await ipc("cef_guest_metadata", { label: guest })
        return metadata.title === `Extension navigation ${load}` && metadata.loading === false
      }, `Guest load ${load} did not finish`)

    await waitForGuest(1)
    assert.deepEqual(await read(), { type: "data", data: null })
    assert.equal(await sequence(), initialSequence)

    await ipc("cef_guest_history", { label: guest, action: "reload" })
    await waitForGuest(2)
    assert.deepEqual(await read(), { type: "data", data: null })
    assert.equal(await sequence(), initialSequence)
    assert.equal(await ui("performance.timeOrigin"), mainDocument)

    await ipc("cef_close_guest", { label: guest })
    guest = undefined
    await ui("setTimeout(() => location.reload(), 100); true")
    await waitFor(async () => {
      const origin = await ui("document.readyState === 'complete' && performance.timeOrigin").catch(() => false)
      return origin && origin !== mainDocument
    }, "Main document did not reload")
    await waitFor(async () => (await sequence()) > initialSequence, "Main document's instances were not cleared")
    await assert.rejects(read, /staleToken/)

    token = (await request({ type: "register", id })).activation.token
    assert.deepEqual(await read(), { type: "data", data: null })
  } finally {
    try {
      if (guest) await ipc("cef_close_guest", { label: guest })
      if (token) await request({ type: "release", token })
      if (installed) {
        await request({ type: "beginTransition", id, action: "uninstall" })
        await request({ type: "commitTransition", id })
      }
    } finally {
      await server.stop(true)
      await rm(directory, { recursive: true, force: true })
    }
  }
})
