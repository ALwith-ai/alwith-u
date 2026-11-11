import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isLayoutStoryBoard } from "../storybook-layout"

test.each(["../pages/example.stories", "../pages/example.stories.tsx"])(
  "resolves %s before reading layout metadata without executing the story",
  (specifier) => {
    const root = mkdtempSync(join(tmpdir(), "u-storybook-layout-"))
    try {
      mkdirSync(join(root, "pages"))
      mkdirSync(join(root, "page-boards"))
      const board = join(root, "page-boards/example.stories.tsx")
      const source = join(root, "pages/example.stories.tsx")
      writeFileSync(board, `import * as source from "${specifier}"\nexport default source.default\n`)
      writeFileSync(
        source,
        'throw new Error("Do not execute stories during discovery")\nconst meta = {\n  tags: ["layout"],\n}\n'
      )
      expect(isLayoutStoryBoard(board)).toBe(true)
      writeFileSync(source, 'const meta = {\n  tags: ["autodocs"],\n}\n')
      expect(isLayoutStoryBoard(board)).toBe(false)
      rmSync(source)
      expect(() => isLayoutStoryBoard(board)).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)

test("discovers layout boards across the complete checked-in catalog", () => {
  const boards = [...new Bun.Glob(".storybook/stories/page-boards/*.stories.tsx").scanSync(".")]
  const layouts = boards.filter(isLayoutStoryBoard)
  expect(layouts.length).toBeGreaterThan(0)
  expect(layouts).toContain(".storybook/stories/page-boards/shared-tabs-layout-1.stories.tsx")
  expect(layouts).not.toContain(".storybook/stories/page-boards/open-main-session.stories.tsx")
  expect(layouts).not.toContain(".storybook/stories/page-boards/open-main-sidebar.stories.tsx")
})
