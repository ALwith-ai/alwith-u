import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "vitest"

import { ipc, requireBrowserFixture, rpc, ui, waitFor } from "./lib/app"

test("browser quick-chat links share the main file and browser areas", async () => {
  await requireBrowserFixture()
  const runtime = await ipc("runtime_capabilities")
  expect(runtime.embeddedBrowser).toBe(true)
  const original = new URL(String(await ui("location.href")))
  const root = await realpath(await mkdtemp(join(tmpdir(), "alwith-quick-links-")))
  const project = join(root, "project")
  const outside = join(root, "quick-chat-directory")
  const insideFile = join(project, "folder", "inside.txt")
  const outsideFile = join(outside, "outside.txt")
  const received = new Set<string>()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const surface = new URL(request.url).searchParams.get("surface")
      if (surface) received.add(surface)
      const title = surface === "quick-chat" ? "Quick link destination" : "Original browser page"
      return new Response(`<!doctype html><title>${title}</title><h1>${title}</h1>`, {
        headers: { "content-type": "text/html" }
      })
    }
  })
  const click = (selector: string) => rpc("click", { window: "main", selector })
  const tabSelected = (title: string) =>
    ui(`[...document.querySelectorAll('[role=tab][aria-selected=true]')].some(
      e=>e.textContent.trim()===${JSON.stringify(title)})`)
  const selectedTree = () =>
    ui(
      `[...document.querySelectorAll('[data-file-path][aria-selected=true]')].map(e=>e.getAttribute('data-file-path'))`
    )
  try {
    await mkdir(join(project, "folder"), { recursive: true })
    await mkdir(outside)
    await Promise.all([
      writeFile(join(project, "source.txt"), "Original project file\nSecond line\n"),
      writeFile(insideFile, "Inside project\nLocate this line\n"),
      writeFile(outsideFile, "Outside project\nLocate this line too\n")
    ])
    const address = new URL("/browser-fixture.html", original)
    address.searchParams.set("chat-links-workspace", project)
    address.searchParams.set("outside", outside)
    address.searchParams.set("web", server.url.href)
    address.searchParams.set("browser-quick-links", "1")
    await rpc("navigate", { window: "main", url: address.href })
    await waitFor(
      () =>
        ui(
          `location.href===${JSON.stringify(address.href)} && !!document.querySelector('[data-chat-links-fixture] a')`
        ).catch(() => false),
      "Quick-link fixture did not load"
    )
    await click('[data-chat-links-fixture] a[href="source.txt:2:1"]')
    await waitFor(() => tabSelected("source.txt"), "The initial file did not open")
    await click('[data-chat-links-fixture] a[href$="surface=main"]')
    await waitFor(
      async () => received.has("main") && (await tabSelected("Original browser page")),
      "The original browser page did not open"
    )

    const quickChat = "[data-browser-quick-chat]"
    const launch = `${quickChat} [aria-label="展开浏览器聊天"]:not(:disabled)`
    await waitFor(() => ui(`!!document.querySelector(${JSON.stringify(launch)})`), "Quick chat is unavailable")
    await click(launch)
    const composer = `${quickChat} textarea`
    await waitFor(() => ui(`!!document.querySelector(${JSON.stringify(composer)})`), "Quick chat composer did not open")
    await rpc("fill", { window: "main", selector: composer, value: "Show the three link samples" })
    await click(`${quickChat} [aria-label="发送"]`)
    const firstLink = `${quickChat} a[href$="/folder/inside.txt#L2"]`
    await waitFor(
      () => ui(`!!document.querySelector(${JSON.stringify(firstLink)})`),
      "Quick chat did not render its links"
    )

    await click(firstLink)
    await waitFor(
      async () => (await tabSelected("inside.txt")) && (await selectedTree()).includes(insideFile),
      "Project link did not open and locate its file"
    )
    expect(await ui(`document.querySelector('[data-file-path]')?.getAttribute('data-file-path')`)).toBe(project)

    await click(`${quickChat} a[href="outside.txt:2:1"]`)
    await waitFor(() => tabSelected("outside.txt"), "The relative outside file did not open")
    expect(await selectedTree()).toEqual([insideFile])
    expect(
      await ui(
        `[...document.querySelectorAll('[data-file-path]')].some(e=>e.getAttribute('data-file-path')===${JSON.stringify(outsideFile)})`
      )
    ).toBe(false)
    expect(await ui(`document.querySelector('[data-file-path]')?.getAttribute('data-file-path')`)).toBe(project)

    await click(`${quickChat} a[href$="surface=quick-chat"]`)
    await waitFor(
      async () => received.has("quick-chat") && (await tabSelected("Quick link destination")),
      "Quick chat did not open a browser tab"
    )
    expect(
      await ui(
        `[...document.querySelectorAll('[role=tab][aria-selected=false]')].some(e=>e.textContent.trim()==="Original browser page")`
      )
    ).toBe(true)
    expect(await selectedTree()).toEqual([insideFile])
    expect(await ui(`[...document.querySelectorAll('[data-sonner-toast]')].map(e=>e.textContent)`)).toEqual([])
  } finally {
    server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)
