import { createFileSystem, type FileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { expect, test, vi } from "vitest"
import { createHtmlPreviewHost } from "../html-preview"

function filesystem(): FileSystem {
  return createFileSystem({
    adapter: createMemoryAdapter({
      "/repo/report/index.html": "<p>Hello</p>",
      "/repo/report/style.css": "body{}",
      "/repo/other.txt": "other"
    }),
    reportError: error => {
      throw error
    }
  })
}

test("opens an isolated native URL and revokes its capability on disposal", async () => {
  const invoke = vi.fn(async (command: string): Promise<unknown> =>
    command === "html_preview_open" ? { token: "token-1", path: "report/index.html" } : undefined
  )
  const host = createHtmlPreviewHost("/repo", filesystem(), invoke, false)
  const preview = await host.open("/repo/report/index.html", "<p>Transformed</p>")
  expect(preview.url).toBe("preview-html://localhost/token-1/report/index.html")
  expect(invoke).toHaveBeenCalledWith("html_preview_open", {
    root: "/repo",
    path: "/repo/report/index.html",
    source: "<p>Transformed</p>"
  })
  await preview.dispose()
  expect(invoke).toHaveBeenLastCalledWith("html_preview_close", { token: "token-1" })
})

test("encodes URL segments on Windows without flattening relative resolution", async () => {
  const invoke = async (): Promise<unknown> => ({ token: "token-2", path: "reports/a #1.html" })
  const preview = await createHtmlPreviewHost("/repo", filesystem(), invoke, true).open("/repo/reports/a #1.html", "x")
  expect(preview.url).toBe("http://preview-html.localhost/token-2/reports/a%20%231.html")
  expect(new URL("../data.json", preview.url).pathname).toBe("/token-2/data.json")
})

test("refreshes on sibling and nested saves and unsubscribes on close", async () => {
  const fs = filesystem()
  const refresh = vi.fn()
  const host = createHtmlPreviewHost("/repo", fs, async () => undefined, false)
  const off = await host.subscribe("/repo/report/index.html", refresh, error => {
    throw error
  })
  await fs.writeFile("/repo/report/style.css", new TextEncoder().encode("body { color: red }"))
  expect(refresh).toHaveBeenCalledTimes(1)
  await fs.writeFile("/repo/other.txt", new TextEncoder().encode("other change"))
  expect(refresh).toHaveBeenCalledTimes(1)
  off()
  await fs.writeFile("/repo/report/style.css", new TextEncoder().encode("body{}"))
  expect(refresh).toHaveBeenCalledTimes(1)
})
