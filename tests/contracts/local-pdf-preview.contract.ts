import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "vitest"

import { ipc, requireBrowserFixture, ui, waitFor } from "./lib/app"

test("an addressed PDF exposes its length and serves bytes beyond 16 MiB to the webview", async () => {
  await requireBrowserFixture()
  const directory = await mkdtemp(join(tmpdir(), "alwith-pdf-preview-"))
  const name = "报告 #1.pdf"
  const path = join(directory, name)
  const start = 17 * 1024 * 1024
  const content = "startxref\n42\n%%EOF"
  const bytes = Buffer.alloc(start + content.length)
  bytes.write("%PDF-1.4")
  bytes.write(content, start)
  let token: string | undefined
  try {
    await writeFile(path, bytes)
    const root = await ipc("plugin:alwith-fs|workspace_open", { path: directory })
    token = await ipc("plugin:alwith-fs|workspace_create_url", { root, path })
    // Hasgard evaluates in an isolated world. Make the requests from the
    // application document so they use its real Tauri URL builder and origin.
    const read = `(async () => {
      const url = window.__TAURI_INTERNALS__.convertFileSrc(${JSON.stringify(token)}, "alwith-file")
        + "/" + encodeURIComponent(${JSON.stringify(name)});
      const head = await fetch(url, { method: "HEAD" });
      const range = await fetch(url, { headers: { Range: "bytes=${start}-${bytes.length - 1}" } });
      return {
        head: head.status,
        length: head.headers.get("Content-Length"),
        range: range.status,
        contentRange: range.headers.get("Content-Range"),
        body: await range.text()
      };
    })().then(
      result => { document.documentElement.dataset.pdfRangeContract = JSON.stringify(result); },
      error => { document.documentElement.dataset.pdfRangeContract = JSON.stringify({ error: String(error) }); }
    );`
    await ui(`(() => {
      const script = document.createElement("script");
      script.textContent = ${JSON.stringify(read)};
      document.head.append(script);
      script.remove();
    })()`)
    const result = await waitFor(
      () => ui("document.documentElement.dataset.pdfRangeContract"),
      "The PDF request did not finish"
    )
    expect(JSON.parse(result)).toEqual({
      head: 200,
      length: String(bytes.length),
      range: 206,
      contentRange: `bytes ${start}-${bytes.length - 1}/${bytes.length}`,
      body: content
    })
  } finally {
    try {
      await ui("delete document.documentElement.dataset.pdfRangeContract")
      if (token !== undefined) await ipc("plugin:alwith-fs|workspace_revoke_url", { token })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})
