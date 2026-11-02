import { readFileSync } from "node:fs"

// Storybook is a catalog, not a test suite. Only stories whose source meta carries the `layout` tag assert what
// jsdom cannot compute (geometry, computed CSS, :hover, canvas, media), so only their generated page boards run
// in the browser. Everything else is covered by vitest unit tests.
const filters = process.argv.slice(2)
const layout = (board: string) => {
  const source = /from "(\.\.\/pages\/[^"]+)"/.exec(readFileSync(board, "utf8"))?.[1]
  if (!source) throw new Error(`${board} does not re-export a source page story`)
  return /^ {2}tags: \[[^\]]*"layout"/m.test(readFileSync(`.storybook/stories/page-boards/${source}`, "utf8"))
}
const files = [...new Bun.Glob(".storybook/stories/page-boards/*.stories.tsx").scanSync(".")]
  .filter(layout)
  .filter((file) => filters.length === 0 || filters.some((filter) => file.includes(filter)))
  .sort()
if (files.length === 0) throw new Error("No layout Storybook files matched the requested filters")
const child = Bun.spawn(
  [process.execPath, "x", "--no-install", "vitest", "run", "--config", ".storybook/vitest.config.ts", ...files],
  { stdin: "inherit", stdout: "inherit", stderr: "inherit" }
)
process.exitCode = await child.exited
export {}
