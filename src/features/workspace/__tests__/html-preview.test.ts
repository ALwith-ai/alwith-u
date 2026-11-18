import { createFileSystem, type FileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { convertFileSrc } from "@tauri-apps/api/core"
import { expect, test, vi } from "vitest"

import { createHtmlPreviewHost } from "../html-preview"

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: vi.fn() }))

function filesystem(): FileSystem {
  return createFileSystem({
    adapter: createMemoryAdapter({
      "/repo/report/index.html": "<p>Hello</p>",
      "/repo/report/style.css": "body{}",
      "/repo/other.txt": "other"
    }),
    reportError: (error) => {
      throw error
    }
  })
}

test("opens an isolated native URL and revokes its capability on disposal", async () => {
  vi.mocked(convertFileSrc).mockReturnValue("preview-html://localhost/token-1")
  const invoke = vi.fn((command: string): Promise<unknown> =>
    Promise.resolve(command === "html_preview_open" ? { token: "token-1", path: "report/index.html" } : undefined)
  )
  const host = createHtmlPreviewHost("/repo", filesystem(), invoke)
  const preview = await host.open("/repo/report/index.html", "<p>Transformed</p>")
  expect(preview.url).toBe("preview-html://localhost/token-1/report/index.html")
  expect(convertFileSrc).toHaveBeenLastCalledWith("token-1", "preview-html")
  expect(invoke).toHaveBeenCalledWith("html_preview_open", {
    root: "/repo",
    path: "/repo/report/index.html",
    source: "<p>Transformed</p>"
  })
  await preview.dispose()
  expect(invoke).toHaveBeenLastCalledWith("html_preview_close", { token: "token-1" })
})

test("appends encoded path segments to the CEF runtime URL", async () => {
  vi.mocked(convertFileSrc).mockReturnValue("http://preview-html.localhost/token-2")
  const invoke = (): Promise<unknown> => Promise.resolve({ token: "token-2", path: "reports/a #1.html" })
  const preview = await createHtmlPreviewHost("/repo", filesystem(), invoke).open("/repo/reports/a #1.html", "x")
  expect(preview.url).toBe("http://preview-html.localhost/token-2/reports/a%20%231.html")
  expect(new URL("../data.json", preview.url).pathname).toBe("/token-2/data.json")
})

test("refreshes on sibling and nested saves and unsubscribes on close", async () => {
  const fs = filesystem()
  const refresh = vi.fn()
  const host = createHtmlPreviewHost("/repo", fs, () => Promise.resolve(undefined))
  const off = await host.subscribe("/repo/report/index.html", refresh, (error) => {
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
