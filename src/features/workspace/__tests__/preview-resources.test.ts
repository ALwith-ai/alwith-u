import { expect, test } from "vitest"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { resolvePreviewResource } from "../preview-resources"
function setup() {
  return createFileSystem({
    adapter: createMemoryAdapter({
      "/repo/doc.html": "<html/>",
      "/repo/assets/a b.css": "body{}",
      "/else/secret.txt": "secret"
    }),
    reportError: error => {
      throw error
    }
  })
}
test("relative preview resources resolve within the project with correct MIME types", async () => {
  const resource = await resolvePreviewResource(setup(), "/repo", "/repo/doc.html", "./assets/a%20b.css?v=2#x")
  expect(resource.path).toBe("/repo/assets/a b.css")
  expect(resource.mimeType).toBe("text/css")
  expect(new TextDecoder().decode(resource.bytes)).toBe("body{}")
})
test.each([
  "../else/secret.txt",
  "%2e%2e/else/secret.txt",
  "file:///else/secret.txt",
  "https://example.com/a.js",
  "//example.com/a.js"
])("preview resource rejects external access: %s", async reference => {
  await expect(resolvePreviewResource(setup(), "/repo", "/repo/doc.html", reference)).rejects.toThrow()
})
