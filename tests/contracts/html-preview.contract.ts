import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "vitest"

import { ipc, requireBrowserFixture, rpc, ui, waitFor } from "./lib/app"

test("opens an HTML file from the file tree and renders its relative stylesheet", async () => {
  await requireBrowserFixture()
  const { backend } = await ipc("runtime_capabilities")
  const original = String(await ui("location.href"))
  const directory = await mkdtemp(join(tmpdir(), "alwith-html-preview-"))
  const file = "示例 & #1.html"
  const preview = "iframe[src$=" + JSON.stringify("/" + encodeURIComponent(file)) + "]"
  try {
    await writeFile(
      join(directory, file),
      `<!doctype html><meta charset="utf-8">
      <link rel="stylesheet" href="./preview.css">
      <h1>HTML preview contract</h1>
      <script>
        addEventListener("load", () => parent.postMessage({
          type: "html-preview-contract",
          text: document.querySelector("h1").textContent,
          style: getComputedStyle(document.body).getPropertyValue("--preview-contract").trim()
        }, "*"));
      </script>`
    )
    await writeFile(join(directory, "preview.css"), "body { --preview-contract: loaded; }")
    const url = new URL(original)
    url.searchParams.set("html-preview-workspace", directory)
    await rpc("navigate", { window: "main", url: url.href })
    const toggle = 'button[aria-label="打开工作区"]'
    await waitFor(
      () => ui(`!!document.querySelector(${JSON.stringify(toggle)})`).catch(() => false),
      "Workspace toolbar did not load"
    )
    await rpc("click", { window: "main", selector: toggle })
    const row = `[data-file-path$=${JSON.stringify("/" + file)}]`
    await waitFor(() => ui(`!!document.querySelector(${JSON.stringify(row)})`), "HTML file was missing from the tree")
    await ui(`(() => {
      window.addEventListener("message", (event) => {
        const frame = document.querySelector(${JSON.stringify(preview)});
        if (frame && event.source === frame.contentWindow && event.data?.type === "html-preview-contract") {
          document.documentElement.dataset.htmlPreviewResult = JSON.stringify(event.data);
        }
      });
    })()`)
    await rpc("dblclick", { window: "main", selector: row })
    const result = await waitFor(
      () => ui("document.documentElement.dataset.htmlPreviewResult"),
      `${backend} did not render the HTML preview`
    )
    expect(JSON.parse(result)).toMatchObject({ text: "HTML preview contract", style: "loaded" })
  } finally {
    try {
      await rpc("navigate", { window: "main", url: original })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})
