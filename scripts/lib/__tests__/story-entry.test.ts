import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "../../..")

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8")
}

test("the app does not install the story module", () => {
  const packageJson = JSON.parse(source("package.json")) as { dependencies?: Record<string, string> }

  expect(packageJson.dependencies).not.toHaveProperty("@alwith/module-story")
})

test("the sidebar does not expose the story entry", () => {
  const sidebar = source("src/features/threads/thread-sidebar.tsx")

  expect(sidebar).not.toContain("onOpenStory")
  expect(sidebar).not.toContain("useStoryAvailable")
})

test("the command palette does not expose the story entry", () => {
  const palette = source("src/features/palette/command-palette.tsx")

  expect(palette).not.toContain("onOpenStory")
  expect(palette).not.toContain("useStoryAvailable")
})
