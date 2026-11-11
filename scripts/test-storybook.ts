import { isLayoutStoryBoard } from "./lib/storybook-layout"

// Storybook is a catalog, not a test suite. Only stories whose source meta carries the `layout` tag assert what
// jsdom cannot compute (geometry, computed CSS, :hover, canvas, media), so only their generated page boards run
// in the browser. Everything else is covered by vitest unit tests.
const filters = process.argv.slice(2)
const files = [...new Bun.Glob(".storybook/stories/page-boards/*.stories.tsx").scanSync(".")]
  .filter(isLayoutStoryBoard)
  .filter((file) => filters.length === 0 || filters.some((filter) => file.includes(filter)))
  .toSorted()
if (files.length === 0) throw new Error("No layout Storybook files matched the requested filters")
const child = Bun.spawn(
  [process.execPath, "x", "--no-install", "vitest", "run", "--config", ".storybook/vitest.config.ts", ...files],
  { stdin: "inherit", stdout: "inherit", stderr: "inherit", env: { ...process.env, STORYBOOK_LAYOUT_TESTS: "1" } }
)
process.exitCode = await child.exited
export {}
